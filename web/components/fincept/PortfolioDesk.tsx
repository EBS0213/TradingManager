"use client";

import {useEffect, useMemo, useRef, useState} from 'react';
import type {FormEvent, ReactNode} from 'react';
import {useQueries, useQuery, useQueryClient} from '@tanstack/react-query';
import {Download, Pencil, Plus, RefreshCw, Search, Trash2, Wallet, X} from 'lucide-react';
import type {Asset, Point} from './data';
import {asOf, valid} from './data';
import styles from './PortfolioDesk.module.css';

type Lot = {id:string;symbol:string;name:string;quantity:number;averageCost:number;acquiredOn:string;createdAt:string;updatedAt:string};
type Entry = {id:string;action:'add'|'edit'|'remove';at:string;position:Lot;before?:Lot};
type Records = {version:1;positions:Lot[];events:Entry[]};
type Market = 'KR'|'US';
type Currency = 'KRW'|'USD';
type Editor = {id:string|null;market:Market;symbol:string;quantity:string;averageCost:string;acquiredOn:string};
type Detail = {item:Asset};
type ValuedLot = {lot:Lot;asset?:Asset;cost:number;value:number|null;pnl:number|null};
type Holding = {symbol:string;name:string;quantity:number;cost:number;value:number|null;pnl:number|null;asset?:Asset;lots:number};
type ValuationPoint = {time:string;value:number;cost:number;pnl:number};
const STORAGE_KEY='tm26.fincept.portfolio.v1';
const EMPTY:Records={version:1,positions:[],events:[]};
const COLORS=['#ff8b2c','#32bdd0','#728af5','#bc86df','#69bc88','#e6c360','#d97699','#9ea9bb'];
export const portfolioCurrency=(symbol:string):Currency=>/^[0-9][0-9A-Z]{5}$/.test(symbol)?'KRW':'USD';
const money=(value:number|null,currency:Currency)=>value===null?'—':new Intl.NumberFormat(currency==='KRW'?'ko-KR':'en-US',{style:'currency',currency,maximumFractionDigits:currency==='KRW'?0:2}).format(value);
const num=(value:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(value);
const pct=(value:number|null)=>value===null?'—':`${value>0?'+':''}${value.toFixed(2)}%`;
const tone=(value:number|null)=>value===null?styles.muted:value>0?styles.positive:value<0?styles.negative:'';
const uid=()=>globalThis.crypto.randomUUID();
const ticker=(value:unknown)=>typeof value==='string'&&/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(value);
function tradingDate(market:Market='US'){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:market==='KR'?'Asia/Seoul':'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=(type:string)=>parts.find(p=>p.type===type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function validDay(value:unknown):value is string{
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
export function validPortfolioLot(value:unknown):value is Lot{
  if(!value||typeof value!=='object')return false;
  const item=value as Lot;
  return typeof item.id==='string'&&item.id.length>0&&item.id.length<=80&&ticker(item.symbol)&&typeof item.name==='string'
    &&valid(item.quantity)&&item.quantity>0&&valid(item.averageCost)&&item.averageCost>0&&Number.isFinite(item.quantity*item.averageCost)
    &&validDay(item.acquiredOn)&&typeof item.createdAt==='string'&&typeof item.updatedAt==='string';
}
function readRecords(raw:string|null):Records{
  if(!raw)return EMPTY;
  const data=JSON.parse(raw);
  if(data?.version!==1||!Array.isArray(data.positions)||!Array.isArray(data.events))throw new Error('저장 형식을 확인할 수 없습니다.');
  if(data.positions.length>100||!data.positions.every(validPortfolioLot)||new Set(data.positions.map((p:Lot)=>p.id)).size!==data.positions.length)throw new Error('저장된 보유 기록을 확인할 수 없습니다.');
  const events=data.events.filter((e:Entry)=>e&&['add','edit','remove'].includes(e.action)&&validPortfolioLot(e.position)&&typeof e.at==='string'&&typeof e.id==='string').slice(-500);
  return {version:1,positions:data.positions,events};
}

// A portfolio may contain any verified equity ticker. Only held symbols are fetched,
// and all portfolio detail requests share four slots, including manual refreshes.
let activeDetails=0;
const detailQueue:{resolve:()=>void;signal:AbortSignal;cancel:()=>void}[]=[];
async function detailSlot(signal:AbortSignal){
  if(signal.aborted)throw signal.reason;
  if(activeDetails<4){activeDetails++;return;}
  await new Promise<void>((resolve,reject)=>{
    const item={resolve:()=>{signal.removeEventListener('abort',item.cancel);resolve();},signal,cancel:()=>{const i=detailQueue.indexOf(item);if(i>=0)detailQueue.splice(i,1);reject(signal.reason);}};
    signal.addEventListener('abort',item.cancel,{once:true});detailQueue.push(item);
  });
}
async function equityDetail(symbol:string,signal:AbortSignal):Promise<Asset>{
  await detailSlot(signal);
  try{
    const response=await fetch(`/api/terminal/equities?symbol=${encodeURIComponent(symbol)}`,{signal});
    if(!response.ok)throw new Error(`종목 조회 실패 (${response.status})`);
    const body:Detail=await response.json();
    if(!body.item||body.item.symbol!==symbol||typeof body.item.name!=='string')throw new Error('해당 티커를 확인할 수 없습니다.');
    return {...body.item,history:Array.isArray(body.item.history)?body.item.history:[]};
  }finally{const next=detailQueue.shift();if(next)next.resolve();else activeDetails--;}
}

export function portfolioValues(positions:Lot[],assets:Map<string,Asset>,currency:Currency=portfolioCurrency(positions[0]?.symbol||'')){
  const lots:ValuedLot[]=positions.map(lot=>{
    const asset=assets.get(lot.symbol),cost=lot.quantity*lot.averageCost;
    const observedValue=portfolioCurrency(lot.symbol)===currency&&asset?.currency===currency&&valid(asset.price)&&asset.status!=='unavailable'?lot.quantity*asset.price:null;
    const value=valid(observedValue)?observedValue:null;
    return {lot,asset,cost,value,pnl:value===null?null:value-cost};
  });
  const grouped=new Map<string,Holding>();
  for(const row of lots){
    const current=grouped.get(row.lot.symbol);
    if(current){current.quantity+=row.lot.quantity;current.cost+=row.cost;current.lots++;current.value=current.value===null||row.value===null?null:current.value+row.value;current.pnl=current.value===null?null:current.value-current.cost;}
    else grouped.set(row.lot.symbol,{symbol:row.lot.symbol,name:row.asset?.name||row.lot.name,quantity:row.lot.quantity,cost:row.cost,value:row.value,pnl:row.pnl,asset:row.asset,lots:1});
  }
  const holdings=[...grouped.values()].sort((a,b)=>(b.value??-1)-(a.value??-1));
  const complete=lots.every(row=>row.value!==null),cost=lots.reduce((s,row)=>s+row.cost,0),knownValue=lots.reduce((s,row)=>s+(row.value??0),0);
  const value=complete?knownValue:null,pnl=positions.length&&value!==null?value-cost:null;
  const dates=new Set(lots.map(row=>row.asset?.asOf?.slice(0,10)).filter(Boolean));
  const dayAvailable=complete&&lots.length>0&&dates.size===1&&lots.every(row=>row.asset?.currency===currency&&row.asset.status!=='stale'&&row.asset.status!=='unavailable'&&valid(row.asset.change)&&row.lot.acquiredOn<(row.asset.asOf?.slice(0,10)||''));
  const dayPnl=dayAvailable?lots.reduce((sum,row)=>sum+row.lot.quantity*(row.asset!.change as number),0):null;
  const largestWeight=value!==null&&value>0&&holdings[0]?.value!==null?holdings[0].value/value*100:null;
  return {lots,holdings,value,cost,knownValue,pnl,returnPct:pnl!==null&&cost>0?pnl/cost*100:null,dayPnl,dayDate:dates.size===1?[...dates][0]:null,largestWeight,complete,missing:lots.filter(row=>row.value===null).length};
}

export function portfolioHistory(positions:Lot[],assets:Map<string,Asset>,currency:Currency=portfolioCurrency(positions[0]?.symbol||'')):ValuationPoint[]{
  if(!positions.length)return [];
  const histories=new Map<string,Map<string,number>>(),dates=new Set<string>();
  for(const lot of positions){
    if(histories.has(lot.symbol))continue;
    const asset=assets.get(lot.symbol);
    if(portfolioCurrency(lot.symbol)!==currency||!asset||asset.currency!==currency||!Array.isArray(asset.history))return [];
    const points=new Map<string,number>();
    for(const point of asset.history as (Point&{isComplete?:boolean|null})[]){
      const date=point.time?.slice(0,10),observedDate=asset.asOf?.slice(0,10);
      const completed=point.isComplete===true||(point.isComplete!==false&&observedDate&&date<observedDate);
      if(!validDay(date)||!valid(point.value)||point.value<=0||!completed)continue;
      points.set(date,point.value);dates.add(date);
    }
    if(!points.size)return [];
    histories.set(lot.symbol,points);
  }
  return [...dates].sort().flatMap(time=>{
    const active=positions.filter(lot=>lot.acquiredOn<=time);
    if(!active.length||active.some(lot=>!histories.get(lot.symbol)?.has(time)))return [];
    const value=active.reduce((sum,lot)=>sum+lot.quantity*histories.get(lot.symbol)!.get(time)!,0);
    const cost=active.reduce((sum,lot)=>sum+lot.quantity*lot.averageCost,0);
    return [{time,value,cost,pnl:value-cost}];
  });
}

function Panel({title,code,children,className=''}:{title:string;code?:string;children:ReactNode;className?:string}){
  return <section className={`${styles.panel} ${className}`}><header className={styles.panelHead}><h2>{title}</h2>{code&&<span>{code}</span>}</header>{children}</section>;
}
function Performance({points,mode,currency}:{points:ValuationPoint[];mode:'value'|'pnl';currency:Currency}){
  const [selected,setSelected]=useState<number|null>(null);
  if(points.length<2)return <div className={styles.chartEmpty}><div className={styles.emptyGrid}/><Wallet size={26}/><strong>평가 추이를 표시할 기록이 없습니다.</strong><p>보유내역과 취득일을 등록하면 실제 일별 종가로 계산합니다.<br/>완료된 공통 거래일이 2일 이상 필요합니다.</p></div>;
  const values=points.map(p=>p[mode]),min=Math.min(...values),max=Math.max(...values),span=max-min||Math.max(Math.abs(max)*.02,1),bottom=min-span*.08,top=max+span*.08;
  const first=Date.parse(points[0].time),elapsed=Date.parse(points.at(-1)!.time)-first||1;
  const x=(point:ValuationPoint)=>10+(Date.parse(point.time)-first)/elapsed*630,y=(value:number)=>218-(value-bottom)/(top-bottom)*190;
  const path=points.map((p,i)=>`${i?'L':'M'}${x(p)},${y(p[mode])}`).join(' '),index=selected===null?points.length-1:Math.min(selected,points.length-1),current=points[index];
  return <div className={styles.chart}><div className={styles.chartReadout}><time>{current.time}</time><strong>{money(current[mode],currency)}</strong><span>{points.length}개 완료 일봉</span></div><div className={styles.plot}>
    <svg viewBox="0 0 650 240" preserveAspectRatio="none" role="img" aria-label={`${points[0].time}부터 ${points.at(-1)!.time}까지 보유분 ${mode==='value'?'평가액':'미실현손익'}`} onMouseMove={event=>{const rect=event.currentTarget.getBoundingClientRect();const date=first+(event.clientX-rect.left)/rect.width*elapsed;setSelected(points.reduce((best,p,i)=>Math.abs(Date.parse(p.time)-date)<Math.abs(Date.parse(points[best].time)-date)?i:best,0));}} onMouseLeave={()=>setSelected(null)}>
      {[0,.25,.5,.75,1].map(t=><line key={t} x1="10" x2="640" y1={y(bottom+(top-bottom)*t)} y2={y(bottom+(top-bottom)*t)} stroke="#30343c" strokeDasharray="3 4"/>)}
      <path d={`${path} L${x(points.at(-1)!)},218 L${x(points[0])},218 Z`} fill="rgba(255,139,44,.055)"/>
      <path d={path} fill="none" stroke="#ff8b2c" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/>
      {selected!==null&&<><line x1={x(current)} x2={x(current)} y1="20" y2="218" stroke="#727780" strokeDasharray="3 3"/><circle cx={x(current)} cy={y(current[mode])} r="4" fill="#ffc37f"/></>}
    </svg><div className={styles.axisLabels}><span>{money(top,currency)}</span><span>{money((top+bottom)/2,currency)}</span><span>{money(bottom,currency)}</span></div></div>
    <div className={styles.dateAxis}><span>{points[0].time}</span><input type="range" min="0" max={points.length-1} value={index} onChange={e=>setSelected(Number(e.target.value))} aria-label="차트 관측일 선택"/><span>{points.at(-1)!.time}</span></div></div>;
}
function Allocation({holdings,total}:{holdings:Holding[];total:number|null}){
  const available=total!==null&&total>0&&holdings.every(h=>h.value!==null),circumference=2*Math.PI*57;
  let offset=0;
  return <div className={styles.allocation}><div className={styles.donut}><svg viewBox="0 0 160 160" role="img" aria-label={available?'종목별 보유 평가액 비중':'보유 비중 자료 없음'}><circle cx="80" cy="80" r="57" fill="none" stroke="#252a32" strokeWidth="17"/>{available&&holdings.map((holding,index)=>{const segment=(holding.value as number)/total*circumference,start=offset;offset+=segment;return <circle key={holding.symbol} cx="80" cy="80" r="57" fill="none" stroke={COLORS[index%COLORS.length]} strokeWidth="17" strokeDasharray={`${segment} ${circumference}`} strokeDashoffset={-start} transform="rotate(-90 80 80)"/>;})}</svg><div><strong>{holdings.length}</strong><span>{holdings.length?'HOLDINGS':'NO HOLDINGS'}</span></div></div>
    {available?<div className={styles.allocationList}>{holdings.map((holding,index)=><div key={holding.symbol}><i style={{background:COLORS[index%COLORS.length]}}/><span>{holding.symbol}</span><b>{((holding.value as number)/total*100).toFixed(1)}%</b></div>)}</div>:<p className={styles.emptySmall}>{holdings.length?'미확인 시세가 있어 전체 비중을 계산하지 않았습니다.':'등록된 보유내역이 없습니다.'}</p>}</div>;
}

export default function PortfolioDesk({onNavigate}:{onNavigate:(page:string)=>void}){
  const client=useQueryClient(),dialog=useRef<HTMLDialogElement>(null),unsaved=useRef(false);
  const [records,setRecords]=useState<Records>(EMPTY),[loaded,setLoaded]=useState(false),[notice,setNotice]=useState(''),[storageBlocked,setStorageBlocked]=useState(false);
  const [editor,setEditor]=useState<Editor|null>(null),[search,setSearch]=useState(''),[debounced,setDebounced]=useState(''),[formError,setFormError]=useState(''),[saving,setSaving]=useState(false);
  const [market,setMarket]=useState<Market>('US');
  const currency:Currency=market==='KR'?'KRW':'USD',cash=(value:number|null)=>money(value,currency);
  const [selected,setSelected]=useState(''),[removeId,setRemoveId]=useState<string|null>(null),[mode,setMode]=useState<'value'|'pnl'>('value'),[range,setRange]=useState(90);
  const maxDay=tradingDate(editor?.market||market);
  useEffect(()=>{try{const saved=readRecords(localStorage.getItem(STORAGE_KEY));setRecords(saved);const preference=localStorage.getItem(STORAGE_KEY+'.market');if(preference==='KR'||preference==='US')setMarket(preference);else if(saved.positions.length&&saved.positions.every(lot=>portfolioCurrency(lot.symbol)==='KRW'))setMarket('KR');}catch{setStorageBlocked(true);setNotice('이 브라우저의 저장 기록을 읽지 못했습니다. 기존 저장값을 덮어쓰지 않았습니다.');}setLoaded(true);},[]);
  useEffect(()=>{if(loaded)try{localStorage.setItem(STORAGE_KEY+'.market',market);}catch{}},[loaded,market]);
  useEffect(()=>{if(editor&&dialog.current&&!dialog.current.open)dialog.current.showModal();},[editor]);
  useEffect(()=>{const timer=setTimeout(()=>setDebounced(search.trim()),300);return()=>clearTimeout(timer);},[search]);
  const symbols=useMemo(()=>[...new Set(records.positions.map(lot=>lot.symbol))].sort(),[records.positions]);
  const quotes=useQueries({queries:symbols.map(symbol=>({queryKey:['fincept','portfolio-equity',symbol],queryFn:({signal}:{signal:AbortSignal})=>equityDetail(symbol,signal),enabled:loaded,staleTime:300_000,retry:1,refetchOnWindowFocus:false}))});
  const assets=new Map<string,Asset>();quotes.forEach((quote,index)=>{if(quote.data)assets.set(symbols[index],quote.data);});
  const marketPositions=records.positions.filter(lot=>portfolioCurrency(lot.symbol)===currency);
  const summary=portfolioValues(marketPositions,assets,currency),busy=quotes.some(query=>query.isFetching);
  const chartPositions=selected?marketPositions.filter(lot=>lot.symbol===selected):marketPositions;
  const history=portfolioHistory(chartPositions,assets,currency),lastDay=history.at(-1)?.time;
  const chartPoints=range&&lastDay?history.filter(point=>Date.parse(lastDay)-Date.parse(point.time)<=range*86_400_000):history;
  const searchResults=useQuery({queryKey:['fincept','portfolio-search',editor?.market,debounced],enabled:!!editor&&debounced.length>0,staleTime:60_000,retry:1,queryFn:async({signal})=>{
    const response=await fetch(`/api/terminal/equities?market=${editor!.market}&q=${encodeURIComponent(debounced)}&page=1&pageSize=12&sort=volume`,{signal});
    if(!response.ok)throw new Error('검색 결과를 불러오지 못했습니다.');
    const body=await response.json();return (Array.isArray(body.items)?body.items:[]).filter((item:Asset)=>ticker(item.symbol)&&item.currency===(editor!.market==='KR'?'KRW':'USD')) as Asset[];
  }});
  const openEditor=(lot?:Lot)=>{setFormError('');setSearch(lot?.symbol||'');setDebounced('');setEditor({id:lot?.id||null,market:lot?(portfolioCurrency(lot.symbol)==='KRW'?'KR':'US'):market,symbol:lot?.symbol||'',quantity:lot?String(lot.quantity):'',averageCost:lot?String(lot.averageCost):'',acquiredOn:lot?.acquiredOn||maxDay});};
  const persist=(mutate:(current:Records)=>Records)=>{
    let base=records;
    if(!unsaved.current){
      try{base=readRecords(localStorage.getItem(STORAGE_KEY));}catch{throw new Error('저장 기록을 읽지 못해 변경하지 않았습니다. 브라우저 저장소를 확인하세요.');}
    }
    const next=mutate(base);setRecords(next);
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));unsaved.current=false;setNotice('이 브라우저에 저장했습니다.');}catch{unsaved.current=true;setNotice('브라우저 저장에 실패했습니다. 이 탭의 기록을 내보내기로 보관해 주세요.');}
  };
  async function save(event:FormEvent){
    event.preventDefault();if(!editor||saving||storageBlocked)return;
    const symbol=(editor.symbol||search).trim().toUpperCase(),quantity=Number(editor.quantity),averageCost=Number(editor.averageCost);
    if(!ticker(symbol)||(editor.market==='KR'?portfolioCurrency(symbol)!=='KRW':portfolioCurrency(symbol)!=='USD')){setFormError('검색 결과를 선택하거나 정확한 종목코드·티커를 입력하세요.');return;}
    if(!editor.quantity.trim()||!valid(quantity)||quantity<=0||!editor.averageCost.trim()||!valid(averageCost)||averageCost<=0||!Number.isFinite(quantity*averageCost)){setFormError('수량과 평균 매입가는 0보다 큰 유한한 숫자로 입력하세요.');return;}
    if(!validDay(editor.acquiredOn)||editor.acquiredOn>maxDay){setFormError('취득일은 선택한 시장의 오늘까지 날짜로 입력하세요.');return;}
    if(!editor.id&&records.positions.length>=100){setFormError('이 브라우저에는 최대 100개의 보유 기록을 저장할 수 있습니다.');return;}
    setSaving(true);setFormError('');
    try{
      const existing=records.positions.find(lot=>lot.id===editor.id);
      const asset=existing?.symbol===symbol?assets.get(symbol):await client.fetchQuery({queryKey:['fincept','portfolio-equity',symbol],queryFn:({signal})=>equityDetail(symbol,signal),staleTime:300_000});
      if(asset&&asset.currency!==(editor.market==='KR'?'KRW':'USD'))throw new Error('선택한 시장의 종목코드·티커를 확인하세요.');
      if(!asset&&!existing)throw new Error('종목을 확인하지 못했습니다. 잠시 후 다시 시도하세요.');
      const at=new Date().toISOString();
      const lot:Lot={id:existing?.id||uid(),symbol,name:asset?.name||existing?.name||symbol,quantity,averageCost,acquiredOn:editor.acquiredOn,createdAt:existing?.createdAt||at,updatedAt:at};
      persist(current=>{
        if(!existing&&current.positions.length>=100)throw new Error('최대 100개의 보유 기록을 저장할 수 있습니다.');
        if(existing&&!current.positions.some(row=>row.id===existing.id))throw new Error('다른 탭에서 삭제된 기록입니다. 페이지를 새로고침하세요.');
        return {version:1,positions:existing?current.positions.map(row=>row.id===existing.id?lot:row):[...current.positions,lot],events:[...current.events,{id:uid(),action:existing?'edit':'add',at,position:lot,...(existing?{before:existing}:{})} as Entry].slice(-500)};
      });
      setMarket(editor.market);setSelected('');setEditor(null);
    }catch(error){setFormError(error instanceof Error?error.message:'종목 확인에 실패했습니다.');}finally{setSaving(false);}
  }
  const remove=(lot:Lot)=>{try{persist(current=>({version:1,positions:current.positions.filter(row=>row.id!==lot.id),events:[...current.events,{id:uid(),action:'remove',at:new Date().toISOString(),position:lot} as Entry].slice(-500)}));setRemoveId(null);if(selected===lot.symbol&&records.positions.filter(row=>row.symbol===lot.symbol).length===1)setSelected('');}catch(error){setNotice(error instanceof Error?error.message:'기록을 삭제하지 못했습니다.');}};
  const download=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(records,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`tm26-portfolio-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
  const positionRows=selected?summary.lots.filter(row=>row.lot.symbol===selected):summary.lots;
  const stale=summary.holdings.some(holding=>holding.asset?.status==='stale');
  return <div className={styles.desk}>
    <header className={styles.header}><div><div className={styles.eyebrow}>TM26 / PORTFOLIO MANAGER</div><h1>포트폴리오</h1><p>보유 기록과 실제 시세를 한 화면에서 확인합니다.</p></div><div className={styles.actions}><span className={styles.localBadge}>LOCAL · {currency}</span><button onClick={()=>quotes.forEach(query=>{void query.refetch();})} disabled={!symbols.length||busy} aria-label="보유 종목 시세 새로고침"><RefreshCw size={14} className={busy?styles.spin:''}/><span>시세 갱신</span></button><button onClick={download} disabled={!records.positions.length&&!records.events.length}><Download size={14}/><span>내보내기</span></button><button className={styles.primary} onClick={()=>openEditor()} disabled={!loaded||storageBlocked}><Plus size={15}/>보유 기록 추가</button></div></header>
    <div className={styles.storageNotice}><span>이 브라우저에만 저장되는 보유 기록입니다. 주문 실행·증권계좌 연동 기능이 아닙니다.</span><button onClick={()=>onNavigate('equities')}>전체 주식 탐색 ↗</button></div>
    {notice&&<div className={styles.notice} role="status">{notice}<button aria-label="알림 닫기" onClick={()=>setNotice('')}><X size={13}/></button></div>}
    <div className={styles.marketTabs} role="group" aria-label="포트폴리오 시장">{([['KR','한국 · KRW'],['US','미국 · USD']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={market===value} className={market===value?styles.active:''} onClick={()=>{setMarket(value);setSelected('');setRemoveId(null);}}>{label}<span>{records.positions.filter(lot=>portfolioCurrency(lot.symbol)===(value==='KR'?'KRW':'USD')).length}</span></button>)}<span>선택한 시장의 통화로 평가합니다.</span></div>
    <div className={styles.metrics}>
      <section><span>PORTFOLIO VALUE</span><strong>{loaded?cash(summary.value):'—'}</strong><p>평가액 · 원가 {cash(summary.cost)}</p></section>
      <section><span>UNREALIZED P&amp;L</span><strong className={tone(summary.pnl)}>{cash(summary.pnl)}</strong><p className={tone(summary.returnPct)}>{pct(summary.returnPct)} <em>입력 원가 대비</em></p></section>
      <section><span>DAY P&amp;L</span><strong className={tone(summary.dayPnl)}>{cash(summary.dayPnl)}</strong><p>{summary.dayPnl===null?'같은 거래일·전일 이전 보유분이 필요합니다.':`${summary.dayDate} · 전일 종가 대비`}</p></section>
      <section><span>CONCENTRATION</span><strong>{summary.largestWeight===null?'—':`${summary.largestWeight.toFixed(1)}%`}</strong><p>최대 종목 비중 · {summary.holdings.length}개 종목</p></section>
    </div>
    {summary.missing>0&&<p className={styles.coverage} role="status">{summary.missing}개 보유 기록의 {currency} 시세를 확인하지 못했습니다. 확인된 평가액은 {cash(summary.knownValue)}이며 전체 평가액·비중은 표시하지 않습니다.</p>}
    {stale&&null}
    <div className={styles.topGrid}>
      <Panel title="보유 종목" code={`${summary.holdings.length} HOLDINGS`} className={styles.holdingsPanel}><div className={styles.holdingToolbar}><button className={!selected?styles.active:''} onClick={()=>setSelected('')}>전체 포트폴리오</button><span>{marketPositions.length}개 기록</span></div><div className={styles.holdingList}>{summary.holdings.map(holding=><button key={holding.symbol} className={`${styles.holding} ${selected===holding.symbol?styles.selected:''}`} onClick={()=>setSelected(holding.symbol)}><div><b>{holding.symbol}</b><strong>{cash(holding.value)}</strong></div><p>{holding.name}</p><div><span>{num(holding.quantity)}주</span><span className={tone(holding.pnl)}>{cash(holding.pnl)}</span></div><small>{holding.asset?`${asOf(holding.asset.asOf)} · ${holding.asset.status==='stale'?'이전 시세':holding.asset.status==='unavailable'?'시세 없음':'관측 시세'}`:'시세 조회 중 / 미확인'}</small></button>)}{!summary.holdings.length&&<div className={styles.holdingsEmpty}><Wallet size={22}/><strong>아직 보유 기록이 없습니다.</strong><p>실제 보유한 종목과 수량을 등록하세요.</p><button onClick={()=>openEditor()} disabled={!loaded||storageBlocked}><Plus size={13}/>첫 기록 추가</button></div>}</div></Panel>
      <Panel title={selected?`${selected} 보유 평가 추이`:'포트폴리오 평가 추이'} code="OBSERVED DAILY CLOSE" className={styles.performancePanel}><div className={styles.chartToolbar}><div>{(['value','pnl'] as const).map(item=><button key={item} className={mode===item?styles.active:''} aria-pressed={mode===item} onClick={()=>setMode(item)}>{item==='value'?'평가액':'미실현손익'}</button>)}</div><div>{[[30,'1M'],[90,'3M'],[0,'ALL']].map(([days,label])=><button key={days} className={range===days?styles.active:''} aria-pressed={range===days} onClick={()=>setRange(Number(days))}>{label}</button>)}</div></div><Performance points={chartPoints} mode={mode} currency={currency}/></Panel>
      <Panel title="자산 배분" code="ALLOCATION"><Allocation holdings={summary.holdings} total={summary.value}/></Panel>
    </div>
    <div className={styles.bottomGrid}>
      <Panel title="보유 내역" code={selected?`${selected} POSITIONS`:`${marketPositions.length} POSITIONS`}><div className={styles.tableWrap}><table className={styles.positions}><thead><tr><th>종목 / 취득일</th><th>수량</th><th>평균 매입가</th><th>현재가</th><th>평가액</th><th>미실현손익</th><th>기록 관리</th></tr></thead><tbody>{positionRows.map(({lot,asset,value,pnl})=><tr key={lot.id}><th><b>{lot.symbol}</b><small>{lot.acquiredOn}</small></th><td>{num(lot.quantity)}</td><td>{cash(lot.averageCost)}</td><td>{cash(portfolioCurrency(lot.symbol)===currency&&asset?.currency===currency&&valid(asset.price)?asset.price:null)}</td><td>{cash(value)}</td><td className={tone(pnl)}>{cash(pnl)}</td><td>{removeId===lot.id?<div className={styles.deleteConfirm}><span>기록 삭제?</span><button onClick={()=>remove(lot)}>삭제</button><button onClick={()=>setRemoveId(null)}>취소</button></div>:<div className={styles.rowActions}><button aria-label={`${lot.symbol} ${lot.acquiredOn} 기록 수정`} onClick={()=>openEditor(lot)} disabled={storageBlocked}><Pencil size={13}/></button><button aria-label={`${lot.symbol} ${lot.acquiredOn} 기록 삭제`} onClick={()=>setRemoveId(lot.id)} disabled={storageBlocked}><Trash2 size={13}/></button></div>}</td></tr>)}</tbody></table>{!positionRows.length&&<div className={styles.tableEmpty}>등록된 보유 내역이 없습니다. 상단의 ‘보유 기록 추가’로 시작하세요.</div>}</div></Panel>
      <Panel title="입력 기록" code="ACTIVITY HISTORY"><div className={styles.ledger}>{records.events.filter(entry=>portfolioCurrency(entry.position.symbol)===currency).reverse().slice(0,50).map(entry=><div key={entry.id}><span className={styles.eventIcon}>{entry.action==='add'?'+':entry.action==='edit'?'↻':'−'}</span><div><strong>{entry.position.symbol} <small>{entry.action==='add'?'보유 등록':entry.action==='edit'?'기록 수정':'기록 삭제'}</small></strong><p>{num(entry.position.quantity)}주 · 평균 {cash(entry.position.averageCost)}</p><time>{asOf(entry.at)}</time></div></div>)}{!records.events.some(entry=>portfolioCurrency(entry.position.symbol)===currency)&&<div className={styles.tableEmpty}>기록을 추가·수정·삭제하면 입력 이력이 표시됩니다.</div>}</div></Panel>
    </div>
    
    
    {editor&&<dialog ref={dialog} className={styles.dialog} onCancel={event=>{event.preventDefault();if(!saving)setEditor(null);}}><form onSubmit={save}><header><div><span>POSITION RECORD</span><h2>{editor.id?'보유 기록 수정':'보유 기록 추가'}</h2></div><button type="button" aria-label="입력 창 닫기" onClick={()=>setEditor(null)} disabled={saving}><X size={18}/></button></header><p className={styles.formIntro}>실제 보유 내역을 입력합니다. 매수·매도 주문은 실행되지 않습니다.</p>
      <fieldset className={styles.marketPicker}><legend>종목 시장</legend>{([['KR','한국 · KRW'],['US','미국 · USD']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={editor.market===value} disabled={saving||!!editor.id} className={editor.market===value?styles.active:''} onClick={()=>{setSearch('');setDebounced('');setFormError('');setEditor({...editor,market:value,symbol:'',averageCost:'',acquiredOn:editor.acquiredOn>tradingDate(value)?tradingDate(value):editor.acquiredOn});}}>{label}</button>)}</fieldset>
      <label>종목 검색 / 코드·티커<div className={styles.searchField}><Search size={15}/><input autoFocus value={search} placeholder={editor.market==='KR'?'삼성전자 또는 005930':'Apple 또는 AAPL'} onChange={event=>{setSearch(event.target.value);setEditor({...editor,symbol:'',market:!editor.id&&(/^[0-9][0-9A-Z]{5}$/.test(event.target.value.trim().toUpperCase())||/[가-힣]/.test(event.target.value))?'KR':editor.market});}} aria-label="종목 검색 또는 티커" autoComplete="off" disabled={saving}/></div></label>
      {editor.symbol?<div className={styles.chosen}><b>{editor.symbol}</b><span>선택한 종목 · 저장할 때 확인합니다.</span></div>:search.trim()&&<div className={styles.searchResults} role="listbox" aria-label="종목 검색 결과">{searchResults.isFetching?<p>종목을 검색하고 있습니다…</p>:searchResults.isError?<p>검색에 실패했습니다. 정확한 코드·티커를 입력해 저장 시 확인할 수 있습니다.</p>:searchResults.data?.length?searchResults.data.map(item=><button type="button" role="option" aria-selected="false" key={item.symbol} onClick={()=>{setSearch(item.symbol);setEditor({...editor,symbol:item.symbol});}}><b>{item.symbol}</b><span>{item.name}</span></button>):<p>검색 결과가 없습니다. 종목코드·티커와 선택한 시장이 맞는지 확인하세요.</p>}</div>}
      <div className={styles.formGrid}><label>보유 수량<input type="number" inputMode="decimal" min="0" step="any" required value={editor.quantity} onChange={event=>setEditor({...editor,quantity:event.target.value})} placeholder="예: 10" disabled={saving}/></label><label>평균 매입가 · {editor.market==='KR'?'KRW':'USD'}<input type="number" inputMode="decimal" min="0" step="any" required value={editor.averageCost} onChange={event=>setEditor({...editor,averageCost:event.target.value})} placeholder="예: 150.50" disabled={saving}/></label></div>
      <label>취득일 · {editor.market==='KR'?'한국':'미국'} 거래일<input type="date" required max={maxDay} value={editor.acquiredOn} onChange={event=>setEditor({...editor,acquiredOn:event.target.value})} disabled={saving}/></label><p className={styles.formHint}>다른 날짜에 취득한 물량은 별도 기록으로 등록하면 평가 추이를 더 정확하게 계산할 수 있습니다.</p>{formError&&<p className={styles.formError} role="alert">{formError}</p>}<div className={styles.formActions}><button type="submit" className={styles.primary} disabled={saving}>{saving?'종목 확인 중…':'확인'}</button></div></form></dialog>}
  </div>;
}

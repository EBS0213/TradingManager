"use client";
import {useMemo} from 'react';
import {useQueries} from '@tanstack/react-query';
import {asOf,getJSON} from './data';
import AutoDataStatus from '../economy/AutoDataStatus';

type ObjectValue=Record<string,unknown>;
type Provider={key:string;name:string;url:string;uses:Set<string>;states:Set<string>;observedAt:string};
const feeds=[
 ['DRAM·국제유가','/api/terminal/industry-prices'],
 ['지수','/api/terminal/market-data'],['한국 주식','/api/terminal/equities?market=KR&symbol=005930'],
 ['미국 주식','/api/terminal/equities?market=US&symbol=AAPL'],['선물','/api/terminal/futures'],
 ['암호화폐','/api/terminal/assets?group=crypto'],['경제·환율·원자재','/api/terminal/economy?view=overview'],
 ['항공','/api/terminal/aviation?view=sources'],['해상·운임','/api/terminal/maritime?view=sources'],['뉴스','/api/terminal/news'],['컨퍼런스콜','/api/calls'],
] as const;
const configured=[
 ['DRAMeXchange','https://www.dramexchange.com/','데이터 › DRAM · 공개 칩·모듈·GDDR·계약가격 전 항목, LPDDR·모바일 회원 전용 표시 · 자동 확인 15분 · 현물 1시간·계약 12시간 캐시'],
 ['오피넷 · 한국석유공사','https://www.opinet.co.kr/glopcoilSelect.do','데이터 › 국제 원유·석유제품 · Dubai 현물, Brent·WTI 선물 · 국제 석유제품 7종 · USD/배럴 · 최신 1시간·장기 6시간 캐시 · 2008년 이후 일별 CSV 자동 수집'],
 ['Esri Light Gray','https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer','해상 지도 · Esri/HERE/Garmin/OSM'],
 ['AISstream','https://aisstream.io/documentation/','수신 AIS 위치·정적 정보 · 위성 전역 커버리지 미확보'],
 ['OpenStreetMap','https://www.openstreetmap.org/copyright','해상 지도'],
 ['MarineTraffic / Kpler AIS','https://servicedocs.marinetraffic.com/','구독 영역 선박 위치'],
 ['Baltic Exchange','https://www.balticexchange.com/','BDI · BCI · BPI · BSI · BDTI · BCTI'],
 ['Shanghai Shipping Exchange Institute','https://en.sse.net.cn/','SCFI · CCFI'],
 ['Freightos Baltic Index','https://fbx.freightos.com/','FBX'],
 ['Drewry','https://www.drewry.co.uk/','WCI'],
 ['NAVER Finance','https://stock.naver.com','지수·미국 주요주식 시가총액 순위와 시세·국내 주식·해외 선물·환율·원자재'],
 ['Yahoo Finance','https://finance.yahoo.com','미국 주식·ETF 일별 종가 · 개인 컴퓨터에 하루 한 번 수집 · 누락 지수 대체 시세와 일봉'],
 ['Nasdaq Trader','https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs','미국 상장 종목 목록'],
 ['Yahoo Finance','https://finance.yahoo.com','미국 기업 통계·재무·목표가'],
 ['Upbit','https://upbit.com','암호화폐'],
 ['주식매니저','https://stock-manager.co.kr/futures/','국내 선물'],
 ['개미집 야간선물','https://gaemizip.com/night','코스피200 야간선물'],
 ['The Motley Fool','https://www.fool.com/earnings-call-transcripts/','컨퍼런스콜 영문 원문'],
 ['Codex · ChatGPT 구독','','컨퍼런스콜 한국어 전문·정리본'],
] as const;
function link(value:unknown){try{const u=new URL(String(value));return /^https?:$/.test(u.protocol)?u.href:'';}catch{return '';}}
function identity(name:string,url:string){
 if(/dramexchange/i.test(name))return ['dramexchange','DRAMeXchange'];
 if(/오피넷|opinet/i.test(name))return ['opinet','오피넷 · 한국석유공사'];
 if(/naver|네이버|npay/i.test(name))return ['naver','NAVER Finance'];
 if(/yahoo/i.test(name))return ['yahoo','Yahoo Finance'];
 if(/massive/i.test(name))return ['massive','Massive'];
 if(/motley|fool\.com|모틀리/i.test(name+' '+url))return ['fool','The Motley Fool'];
 if(/upbit|업비트/i.test(name))return ['upbit','Upbit'];
 if(/codex/i.test(name))return ['codex','Codex · ChatGPT 구독'];
 return [name.toLowerCase(),name];
}
export default function DataSourcesDesk(){
 const queries=useQueries({queries:feeds.map(([scope,url])=>({queryKey:['fincept','source-status',scope],queryFn:({signal}:{signal:AbortSignal})=>getJSON<ObjectValue>(url,signal),staleTime:300000,refetchInterval:300000,retry:1,refetchOnWindowFocus:false}))});
 const rows=useMemo(()=>{
  const entries=new Map<string,Provider>();
  const add=(name:string,url:string,scope:string,status='',time='')=>{
   if(!name||name==='TM26 공개 RSS')return;
   const [key,label]=identity(name,url),row=entries.get(key)||{key,name:label,url:link(url),uses:new Set<string>(),states:new Set<string>(),observedAt:''};
   if(!row.url)row.url=link(url);row.uses.add(scope);if(status)row.states.add(status);
   if(time&&(!row.observedAt||Date.parse(time)>Date.parse(row.observedAt)))row.observedAt=time;
   entries.set(key,row);
  };
  configured.forEach(([name,url,scope])=>add(name,url,scope));
  const walk=(value:unknown,scope:string,depth=0)=>{
   if(depth>9||!value||typeof value!=='object')return;
   if(Array.isArray(value)){value.forEach(item=>walk(item,scope,depth+1));return;}
   const item=value as ObjectValue,status=String(item.status||item.dataStatus||''),time=String(item.asOf||item.updatedAt||item.fetchedAt||item.lastUpdated||'');
   const source=item.source;
   if(typeof source==='string')add(source,'',scope,status,time);
   if(source&&typeof source==='object'){
    const s=source as ObjectValue;add(String(s.name||s.label||''),String(s.url||''),scope,status,time);
   }
   for(const key of ['sources','connectors'])if(Array.isArray(item[key]))for(const raw of item[key] as ObjectValue[])add(String(raw.name||raw.label||''),String(raw.url||''),scope,String(raw.status||status),time);
   if((item.pipeline as ObjectValue)?.id==='foolcalls-codex-v1'){
    add('Codex · ChatGPT 구독','',scope,'available',String(item.madeAt||''));
    add('The Motley Fool','https://www.fool.com/earnings-call-transcripts/',scope,'available',String(item.date||''));
   }
   Object.entries(item).filter(([key])=>!['source','sources','connectors','history','paragraphs','documents'].includes(key)).forEach(([,child])=>walk(child,scope,depth+1));
  };
  queries.forEach((query,index)=>{if(query.data)walk(query.data,feeds[index][0]);});
  return [...entries.values()].sort((a,b)=>a.name.localeCompare(b.name));
 },[queries]);
 const state=(row:Provider)=>[...row.states].some(s=>['available','connected','delayed','observed','realtime'].includes(s))?'자료 수신':row.states.has('stale')?'이전 자료':row.states.has('on_request')?'요청 시 조회':row.states.has('key_required')?'미연결':row.states.has('unavailable')?'자료 없음':'미확인';
 return <div className="fc-desk"><header className="fc-desk-title"><div><h1>데이터 소스</h1><span>DATA SOURCES</span></div><AutoDataStatus/></header>
  {queries.some(q=>q.isPending)?<p role="status">연결 상태 확인 중…</p>:null}
  {queries.some(q=>q.isError)?<p role="status">조회 실패: {queries.flatMap((q,i)=>q.isError?[feeds[i][0]]:[]).join(' · ')}</p>:null}
  <section className="fc-panel"><div className="fc-panel-head"><h2>제공처와 사용 범위</h2><span>{rows.length} SOURCES</span></div><div className="fc-table-wrap"><table className="fc-table"><thead><tr><th>제공처</th><th>사용 범위</th><th>상태</th><th>최근 자료</th></tr></thead><tbody>{rows.map(row=><tr key={row.key}><th>{row.url?<a href={row.url} target="_blank" rel="noopener noreferrer">{row.name} ↗</a>:row.name}</th><td>{[...row.uses].join(' · ')}</td><td>{state(row)}</td><td>{row.observedAt?asOf(row.observedAt):'—'}</td></tr>)}</tbody></table></div></section>
 </div>;
}

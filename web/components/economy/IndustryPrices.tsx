"use client";
import {useState} from 'react';
import dynamic from 'next/dynamic';
import AutoDataStatus from './AutoDataStatus';
import {useQuery} from '@tanstack/react-query';
import type {EconomySeries} from './types';
import styles from './IndustryPrices.module.css';

const OilHistory=dynamic(()=>import('./OilHistory'),{loading:()=> <p role="status">장기 추이를 불러오는 중입니다…</p>});

type Price=EconomySeries & {group:string;access:'public'|'member_required';period?:string;periodHigh?:number;periodLow?:number;high?:number;low?:number;changePercent?:number|null;lowChangePercent?:number|null};
type Feed={id:string;status:string;fetchedAt:string|null;error:string|null;series:Price[]};
type Prices={series:Price[];feeds:Feed[]};
const groups:Record<string,string>={'dram-spot':'DRAM 칩 현물','module-spot':'DRAM 모듈 현물','gddr-spot':'GDDR 현물','dram-contract':'DRAM 계약가격','dram-quote':'DRAM 칩 유통가격','rdimm-quote':'서버 DRAM 모듈 가격','udimm-quote':'PC DRAM 모듈 가격','sodimm-quote':'노트북 DRAM 모듈 가격','lpddr-quote':'LPDDR 유통가격','lpddr-spot':'LPDDR 현물','mobile-contract':'모바일 DRAM 계약가격','oil-crude':'국제 원유','oil-products':'국제 석유제품'};
const number=(value:number|null|undefined,digits=3)=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:digits}).format(value):'—';
const time=(value:string|null)=>value?(value.includes('T')?new Date(value).toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,16)+' KST':value):'—';
const signed=(value:number|null|undefined)=>typeof value==='number'?`${value>0?'+':''}${number(value,2)}`:'—';

export default function IndustryPrices({view}:{view:'dram'|'oil'}) {
  const [search,setSearch]=useState('');
  const query=useQuery({queryKey:['industry-prices',view],queryFn:async({signal}):Promise<Prices>=>{
    const response=await fetch(`/api/terminal/industry-prices?view=${view}`,{signal});
    if(!response.ok)throw new Error('가격 조회 실패');
    const data=await response.json();
    if(!Array.isArray(data.series)||!Array.isArray(data.feeds))throw new Error('가격 응답 오류');
    return data;
  },staleTime:5*60*1000,refetchInterval:15*60*1000,refetchOnWindowFocus:false,retry:1});
  const series=query.data?.series||[], available=series.filter(row=>row.value!==null).length;
  const rows=series.filter(row=>`${row.name} ${groups[row.group]}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const order=view==='dram'?['dram-spot','dram-quote','module-spot','rdimm-quote','udimm-quote','sodimm-quote','gddr-spot','dram-contract','lpddr-quote','lpddr-spot','mobile-contract']:['oil-crude','oil-products'];
  return <section className={`tm-economy eco-hub ${styles.root}`} aria-label={view==='dram'?'DRAM 부품별 가격':'국제 원유·석유제품 가격'}>
    <div className={styles.toolbar}><div><h2>{view==='dram'?'DRAM 부품별 가격':'국제 원유·석유제품 가격'}</h2><span>가격 {available}종 · 회원 전용 {series.filter(row=>row.access==='member_required').length}종</span></div>
      <label>품목 검색<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder={view==='dram'?'DDR5 · DDR4 · GDDR':'Dubai · 경유 · 나프타'}/></label>
    </div>
    {query.isPending?<p role="status">가격을 불러오는 중입니다…</p>:null}
    {query.isError?<p className="eco-alert" role="alert">가격 조회 지연 · 자동으로 재시도합니다.</p>:null}
    {query.data?.feeds.filter(feed=>feed.error).map(feed=><p key={feed.id} className="eco-alert" role="status">{feed.id.startsWith('dram')?'DRAM':'국제유가'} · {feed.error}</p>)}
    <div className={styles.autoStatus}><AutoDataStatus/></div>
    {view==='oil'?<OilHistory/>:null}
    {order.map(group=>{
      const items=rows.filter(row=>row.group===group);
      if(!items.length)return null;
      const dram=view==='dram', locked=items.every(row=>row.access==='member_required'), contract=group==='dram-contract', quote=group.endsWith('-quote');
      const stamp=query.data?.feeds.find(feed=>feed.series.some(row=>row.group===group))?.fetchedAt;
      return <section key={group} className={`eco-panel ${styles.panel}`} aria-label={groups[group]}>
        <header><h3>{groups[group]} <small>{items.length}종</small></h3><span>{dram?'USD/개':'USD/배럴'} · 수집 {time(stamp||null)}</span></header>
        <div className={styles.scroll} tabIndex={0} aria-label={`${groups[group]} 가격 표, 가로 스크롤 가능`}><table>
          <caption className={styles.srOnly}>{groups[group]} · {dram?'USD/개':'USD/배럴'}</caption>
          <thead><tr><th scope="col">품목</th>{dram&&!locked&&!quote?<><th scope="col">{contract?'평균':'세션 평균'}</th><th scope="col">{contract?'최고':'세션 최고'}</th><th scope="col">{contract?'최저':'세션 최저'}</th>{!contract?<><th scope="col">{group==='dram-spot'?'일중':'주간'} 최고</th><th scope="col">{group==='dram-spot'?'일중':'주간'} 최저</th></>:null}<th scope="col">평균 변동 %</th>{contract?<th scope="col">최저 변동 %</th>:null}</>:locked?<th scope="col">가격</th>:<><th scope="col">최근 가격</th><th scope="col">직전 가격</th><th scope="col">변동 {dram?'USD/개':'USD/배럴'}</th><th scope="col">변동 %</th></>}<th scope="col">기준일{dram?'시':''}</th><th scope="col">상태</th></tr></thead>
          <tbody>{items.map(row=><tr key={row.id}><th scope="row">{row.name}</th>{dram&&!locked&&!quote?<><td>{number(row.value)}</td><td>{number(row.high)}</td><td>{number(row.low)}</td>{!contract?<><td>{number(row.periodHigh)}</td><td>{number(row.periodLow)}</td></>:null}<td>{signed(row.changePercent)}</td>{contract?<td>{signed(row.lowChangePercent)}</td>:null}</>:locked?<td>—</td>:<><td>{number(row.value,2)}</td><td>{number(row.previous,2)}</td><td>{signed(row.change)}</td><td>{signed(row.changePercent)}</td></>}<td>{time(row.asOf)}{row.period?<small>{row.period}</small>:null}</td><td><span className={`eco-status eco-status-${row.status}`}>{row.access==='member_required'?'회원 전용':row.status==='available'?'수신':row.status==='stale'?'이전 자료':'미제공'}</span></td></tr>)}</tbody>
        </table></div>
      </section>;
    })}
    {!query.isPending&&query.data&&!rows.length&&series.length?<p role="status">검색 조건에 맞는 품목이 없습니다.</p>:null}
  </section>;
}

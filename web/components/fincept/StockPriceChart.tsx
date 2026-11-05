"use client";

import {useMemo,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {chartPoints,stockLevels,type ChartPoint} from '@/lib/stock-chart';
import type {SetupZone} from '@/lib/setup-chart';
import InteractiveStockChart from './InteractiveStockChart';
import styles from './StockPriceChart.module.css';

type Props={points:ChartPoint[];symbol:string;market:'KR'|'US';currency?:string;high52?:number|null;metadata?:Record<string,unknown>|null;historyStatus?:string;tradingLevels?:boolean;setup?:SetupZone};
type OldBar={d:string;o?:number|null;h?:number|null;l?:number|null;c:number;v?:number|null};
const fromOld=(rows:OldBar[])=>rows.map(r=>({time:r.d.length===8?`${r.d.slice(0,4)}-${r.d.slice(4,6)}-${r.d.slice(6,8)}`:r.d,value:r.c,open:r.o,high:r.h,low:r.l,volume:r.v}));
async function read<T>(url:string,signal:AbortSignal):Promise<T>{const response=await fetch(url,{signal});const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||'차트 자료 조회 실패');return data;}

export default function StockPriceChart({points,symbol,market,currency=market==='KR'?'KRW':'USD',high52,metadata,historyStatus,tradingLevels=false,setup}:Props){
 const [long,setLong]=useState(false);
 const meta=useQuery({queryKey:['stock-chart-levels',market,symbol],queryFn:({signal})=>read<{row:Record<string,unknown>|null}>(`/api/screener/latest?${new URLSearchParams({market,symbol})}`,signal),enabled:tradingLevels&&metadata===undefined&&!!symbol,staleTime:60000,retry:1});
 const account=useQuery({queryKey:['workspace-account'],queryFn:({signal})=>read<{signedIn:boolean}>('/api/auth/me',signal),staleTime:60000,retry:1});
 const extended=useQuery({queryKey:['stock-chart-daily',market,symbol],queryFn:({signal})=>read<{daily:OldBar[]}>(`/api/ohlcv?${new URLSearchParams({code:symbol})}`,signal),enabled:account.data?.signedIn===true,staleTime:3600000,retry:1});
 const history=useQuery({queryKey:['stock-chart-history',market,symbol],queryFn:({signal})=>read<{daily?:OldBar[];weekly?:OldBar[];monthly?:OldBar[]}>(`/api/ohlcv?${new URLSearchParams({code:symbol,span:'long'})}`,signal),enabled:long&&account.data?.signedIn===true,staleTime:3600000,retry:1});
 const daily=useMemo(()=>chartPoints([...fromOld(history.data?.daily||[]),...fromOld(extended.data?.daily||[]),...points]),[history.data,extended.data,points]);
 const weekly=useMemo(()=>chartPoints(fromOld(history.data?.weekly||[])),[history.data]);
 const monthly=useMemo(()=>chartPoints(fromOld(history.data?.monthly||[])),[history.data]);
 const levels=useMemo(()=>tradingLevels?stockLevels(metadata===undefined?meta.data?.row:metadata,high52):[],[tradingLevels,metadata,meta.data,high52]);
 return <InteractiveStockChart key={`${market}:${symbol}`} daily={daily} weekly={weekly} monthly={monthly} levels={levels} setup={setup} symbol={symbol} currency={currency} tradingLevels={tradingLevels} onLongRange={()=>setLong(true)} historyPending={history.isFetching} historyLoaded={!!history.data} status={<>
  {long&&account.data?.signedIn===false?<div className={styles.status}><a href={'/login?next='+encodeURIComponent('/#'+(typeof window==='undefined'?'terminal/equities':window.location.hash.slice(1)))}>로그인 후 과거 데이터 불러오기</a></div>:null}
  {tradingLevels&&meta.isError?<div className={styles.status} role="alert">기준선 조회 실패 <button type="button" onClick={()=>void meta.refetch()}>다시 조회</button></div>:null}
  {history.isError?<div className={styles.status} role="alert">{history.error.message} <button type="button" onClick={()=>void history.refetch()}>다시 조회</button></div>:null}
  {extended.isError?<div className={styles.status} role="alert">추가 일봉 조회 실패 <button type="button" onClick={()=>void extended.refetch()}>다시 조회</button></div>:null}
  {historyStatus==='stale'?<div className={styles.status} role="status">이전 관측 일봉</div>:null}
 </>}/>;
}

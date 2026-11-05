"use client";
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {type ReactNode} from 'react';
import type {SetupZone} from '@/lib/setup-chart';
import StockPriceChart from '../StockPriceChart';
import styles from './TradingWorkspace.module.css';
export {styles};
export type Row=Record<string,unknown>;
export const num=(v:unknown)=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
export const fmt=(v:unknown,digits=2)=>num(v)===null?'—':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:digits});
export const text=(v:unknown)=>typeof v==='string'?v:'';
export const percent=(v:unknown,fraction=false)=>num(v)===null?'—':(Number(v)>0?'+':'')+fmt(Number(v)*(fraction?100:1))+'%';
export const tone=(v:unknown)=>Number(v)>0?styles.up:Number(v)<0?styles.down:'';
export const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function api<T>(url:string,init?:RequestInit):Promise<T>{
 const response=await fetch(url,{cache:'no-store',...init});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.ok===false)throw new Error(data.error||'자료를 불러오지 못했습니다. ('+response.status+')');
 return data;
}
export function Panel({title,actions,children,className=''}:{title:string;actions?:ReactNode;children:ReactNode;className?:string}){
 return <section className={styles.panel+' '+className}><header><h2>{title}</h2>{actions}</header>{children}</section>;
}
export function Metrics({items}:{items:{label:string;value:ReactNode;className?:string}[]}){
 return <div className={styles.metrics}>{items.map(item=><div key={item.label}><span>{item.label}</span><strong className={item.className}>{item.value}</strong></div>)}</div>;
}
export function Message({children,error=false}:{children:ReactNode;error?:boolean}){return <div className={error?styles.error:styles.empty} role={error?'alert':'status'}>{children}</div>;}
export type Watch={코드:string;종목명:string;메모?:string;추가일?:string};
export type Holding={name:string;code:string;market?:string;qty:number|null;avg:number|null;price:number|null;why?:string};
export type Log=Row&{date:string;name:string;code:string;side:string;buy:number|null;sell:number|null;qty:number|null};
export type Journal={cash?:number;holdings?:Holding[];log?:Log[];mind?:Record<string,string|Record<string,string>>;watchlist?:Watch[];bet?:Row;pyr?:Row;entries?:Row[]};
type JournalResponse={ok:boolean;data:Journal|null;updated_at?:string;email?:string;admin?:boolean};
export function useJournal(){
 const client=useQueryClient();
 const account=useQuery({queryKey:['workspace-account'],queryFn:({signal})=>api<{signedIn:boolean}>('/api/auth/me',{signal}),staleTime:60000,retry:1});
 const query=useQuery({queryKey:['trading','journal'],queryFn:async({signal})=>{
   const response=await fetch('/api/screener/journal',{signal,cache:'no-store'});
   if(response.status===401)return null;
   const value=await response.json();if(!response.ok||!value.ok)throw new Error(value.error||'기록을 불러오지 못했습니다.');return value as JournalResponse;
 },enabled:account.data?.signedIn===true,staleTime:30000,retry:1});
 const save=useMutation({mutationFn:(patch:Journal)=>api<{ok:boolean}>('/api/screener/journal',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}),
 onSuccess:(_,patch)=>{client.setQueryData<JournalResponse|null>(['trading','journal'],old=>old?{...old,data:{...old.data,...patch},updated_at:new Date().toISOString()}:old);}});
 return {query:{...query,isPending:account.isPending||(account.data?.signedIn===true&&query.isPending),isError:account.isError||query.isError,error:account.error||query.error},save,data:account.data?.signedIn?query.data?.data||{}:{},signedIn:account.data?.signedIn===true&&!!query.data};
}
export function LoginPrompt({page}:{page:string}){return <Message><a href={'/login?next='+encodeURIComponent('/#trading/'+page)}>로그인</a></Message>;}
export type Bar=[string,number,number,number,number,number];
export {default as CandleChart} from './TrainingChart';
export function StockChart({symbol,market,metadata,setup}:{symbol:string;market:'KR'|'US';metadata?:Row;setup?:SetupZone}){
 const q=useQuery({queryKey:['trading','chart',market,symbol],queryFn:({signal})=>api<{item:{history:{time:string;value:number;open?:number;high?:number;low?:number;volume?:number}[]}}>(
 '/api/terminal/equities?'+new URLSearchParams({market,symbol}),{signal}),enabled:!!symbol,staleTime:300000,retry:1});
 if(q.isPending)return <Message>차트 불러오는 중…</Message>;
 if(q.isError)return <Message error>{q.error.message}<button onClick={()=>void q.refetch()}>다시 조회</button></Message>;
 return <StockPriceChart tradingLevels metadata={metadata} setup={setup} symbol={symbol} market={market} points={q.data.item?.history||[]}/>;
}

"use client";
import {useEffect,useRef} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from './TradingCommon';
type Market='KR'|'US';
type Job={id:string;status:'requested'|'running'|'done'|'failed';error?:string};
type Status={ok:boolean;agent:boolean;stamps?:Partial<Record<Market,string>>;jobs?:Partial<Record<Market,Job>>};
export default function useScreeningRefresh(market:Market){
 const client=useQueryClient();
 const seen=useRef<Partial<Record<Market,string>>>({});
 const status=useQuery({queryKey:['screener-status'],queryFn:({signal})=>api<Status>('/api/screener/status',{signal}),refetchInterval:3000,retry:1});
 useEffect(()=>{
  if(!status.data)return;
  for(const m of ['KR','US'] as const){
   const job=status.data.jobs?.[m];
   const version=(status.data.stamps?.[m]||'')+':'+(job?.id||'')+':'+(job?.status||'');
   const previous=seen.current[m];seen.current[m]=version;
   if(previous&&previous!==version){
    void client.invalidateQueries({queryKey:['trading','screen',m]});
    void client.invalidateQueries({queryKey:['trading','setup',m]});
   }
  }
 },[status.data,client]);
 const run=useMutation({mutationFn:(m:Market)=>api<{ok:boolean;job:string}>('/api/screener/refresh?market='+m,{method:'POST'}),
  onSuccess:(result,m)=>{
   client.setQueryData<Status>(['screener-status'],old=>({...old,ok:true,agent:old?.agent??false,jobs:{...old?.jobs,[m]:{id:result.job,status:'requested'}}}));
   void client.invalidateQueries({queryKey:['screener-status']});
  },onError:()=>{void client.invalidateQueries({queryKey:['screener-status']});}});
 const job=status.data?.jobs?.[market];
 const busy=(run.isPending&&run.variables===market)||job?.status==='requested'||job?.status==='running';
 const error=run.isError&&run.variables===market?run.error.message:job?.status==='failed'?job.error||'스크리너 실행에 실패했습니다.':null;
 return {busy,error,job,agent:status.data?.agent,request:()=>run.mutate(market)};
}

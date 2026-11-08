"use client";
import {useMemo,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Download} from 'lucide-react';
import {CartesianGrid,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import type {EconomySeries} from './types';
import {economyCsv,economyNumber} from './types';
import {aggregateOilPoints} from './oil-history-view.mjs';
import styles from './OilHistory.module.css';
type History={series:EconomySeries[];feeds:{kind:string;error:string|null;coverage:{from:string;to:string;dates:number}|null}[]};
const COLORS=['#eda12c','#73b6da','#b48bd8','#79bfa0','#e88484','#d1cd77','#9eb0c9'];
const RANGE_OPTIONS=[['1M','1개월'],['3M','3개월'],['1Y','1년'],['3Y','3년'],['5Y','5년'],['ALL','전체']] as const;
export default function OilHistory(){
  const query=useQuery({queryKey:['oil-history'],queryFn:async({signal}):Promise<History>=>{
    const response=await fetch('/api/terminal/oil-history',{signal});if(!response.ok)throw new Error('장기 자료 조회 실패');return response.json();
  },staleTime:15*60000,refetchInterval:15*60000,refetchOnWindowFocus:false,retry:1});
  const [kind,setKind]=useState('crude'),[range,setRange]=useState('5Y'),[frequency,setFrequency]=useState('daily');
  const [selectedIds,setSelectedIds]=useState<string[]|null>(null),[customFrom,setCustomFrom]=useState(''),[customTo,setCustomTo]=useState('');
  const items=useMemo(()=>query.data?.series.filter(row=>row.id.startsWith(`OPINET:${kind}:`))||[],[query.data,kind]);
  const feed=query.data?.feeds.find(row=>row.kind===kind),last=feed?.coverage?.to||'';
  const end=range==='custom'&&customTo?customTo:last;
  const start=useMemo(()=>{
    if(range==='custom')return customFrom||feed?.coverage?.from||'';
    if(range==='ALL')return feed?.coverage?.from||'';
    if(!last)return '';
    const date=new Date(last+'T00:00:00Z');
    if(range.endsWith('M'))date.setUTCMonth(date.getUTCMonth()-Number(range.slice(0,-1)));else date.setUTCFullYear(date.getUTCFullYear()-Number(range.slice(0,-1)));
    return date.toISOString().slice(0,10);
  },[range,customFrom,feed?.coverage?.from,last]);
  const visible=useMemo(()=>items.filter(row=>selectedIds===null||selectedIds.includes(row.id)).map(row=>({...row,frequency,
    points:aggregateOilPoints(row.points.filter(point=>point.date>=start&&point.date<=end),frequency)})),[items,selectedIds,start,end,frequency]);
  const chartRows=useMemo(()=>{
    const dates=new Map<string,Record<string,string|number|null>>();
    visible.forEach((row,index)=>row.points.forEach((point:{date:string;value:number|null})=>{const value=dates.get(point.date)||{date:point.date};value[`p${index}`]=point.value;dates.set(point.date,value)}));
    return [...dates.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  },[visible]);
  const toggle=(id:string)=>setSelectedIds(old=>{const ids=old??items.map(row=>row.id);return ids.includes(id)?ids.filter(value=>value!==id):[...ids,id]});
  const download=()=>{
    const url=URL.createObjectURL(new Blob([economyCsv(visible)],{type:'text/csv;charset=utf-8;'}));const link=document.createElement('a');link.href=url;link.download=`tm26-oil-${kind}-${start}-${end}-${frequency}.csv`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className={`eco-panel ${styles.root}`} aria-label="원유·석유제품 장기 추이">
    <header><div><h2>장기 가격 추이</h2><span>USD/배럴 · 확보 기간 {feed?.coverage?`${feed.coverage.from} ~ ${feed.coverage.to}`:'확인 중'}</span></div><button type="button" className="eco-button" disabled={!chartRows.length} onClick={download}><Download size={13}/> CSV</button></header>
    <div className={styles.filters}><label>종류<select aria-label="장기 추이 종류" value={kind} onChange={event=>{setKind(event.target.value);setSelectedIds(null);}}><option value="crude">원유</option><option value="products">석유제품</option></select></label><label>집계<select aria-label="유가 집계 주기" value={frequency} onChange={event=>setFrequency(event.target.value)}><option value="daily">일별</option><option value="weekly">주 평균</option><option value="monthly">월 평균</option><option value="annual">연 평균</option></select></label><div className={styles.ranges} aria-label="유가 표시 기간">{RANGE_OPTIONS.map(([id,label])=><button type="button" key={id} aria-pressed={range===id} onClick={()=>setRange(id)}>{label}</button>)}</div><label>시작일<input type="date" aria-label="유가 시작일" min={feed?.coverage?.from} max={end||last} value={start} onChange={event=>{setCustomFrom(event.target.value);setCustomTo(end);setRange('custom')}}/></label><label>종료일<input type="date" aria-label="유가 종료일" min={start} max={last} value={end} onChange={event=>{setCustomFrom(start);setCustomTo(event.target.value);setRange('custom')}}/></label></div>
    <div className={styles.products} aria-label="추이 품목 선택">{items.map((row,index)=><label key={row.id}><input type="checkbox" checked={selectedIds===null||selectedIds.includes(row.id)} onChange={()=>toggle(row.id)}/><i style={{background:COLORS[index%COLORS.length]}}/>{row.name}</label>)}</div>
    {query.isPending?<p className="eco-loading" role="status">장기 가격 자료를 불러오는 중입니다…</p>:query.isError?<p className="eco-alert" role="status">장기 자료 조회 지연 · 자동으로 재시도합니다.</p>:feed?.error?<p className="eco-alert" role="status">{feed.error}</p>:null}
    {chartRows.length?<><div className="eco-chart" role="img" aria-label={`${kind==='crude'?'원유':'석유제품'} ${start}부터 ${end}까지 가격 추이, USD/배럴`}><ResponsiveContainer width="100%" height="100%"><LineChart data={chartRows} margin={{top:16,right:24,left:0,bottom:4}}><CartesianGrid stroke="#292b30" strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" tick={{fill:'#92959e',fontSize:10}} minTickGap={70}/><YAxis domain={['auto','auto']} tick={{fill:'#92959e',fontSize:10}} width={58}/><Tooltip contentStyle={{background:'#15171c',border:'1px solid #45403a',fontSize:12}} formatter={value=>[`${economyNumber(typeof value==='number'?value:null)} USD/배럴`]}/>{visible.map((row,index)=><Line key={row.id} dataKey={`p${index}`} name={row.name} stroke={COLORS[items.findIndex(item=>item.id===row.id)%COLORS.length]} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div><div className={styles.summary}><span>{start} ~ {end} · {chartRows.length.toLocaleString()}개 기간{frequency!=='daily'?' · 확보된 일별 가격의 산술평균':''}</span><span>휴장·미제공 값 제외</span></div></>:!query.isPending&&!feed?.error?<p className="eco-empty">표시할 품목과 기간을 선택해 주세요.</p>:null}
  </section>;
}

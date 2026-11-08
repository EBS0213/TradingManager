"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {Download,LineChart as ChartIcon,Table2,X} from 'lucide-react';
import {CartesianGrid,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import type {EconomySeries} from './types';
import {economyCountry,economyCsv,economyFrequency,economyNumber} from './types';
import {economyChangeUnit} from './dashboard.mjs';
import styles from './EconomyHub.module.css';

export default function EconomySeriesDetail({series,onClose}:{series:EconomySeries;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),title=useId();
  const [display,setDisplay]=useState<'chart'|'table'>('chart');
  useEffect(()=>{if(dialog.current&&!dialog.current.open)dialog.current.showModal();},[]);
  const points=series.points||[],hasPoints=points.some(point=>typeof point.value==='number'&&Number.isFinite(point.value));
  const exportCsv=()=>{
    const url=URL.createObjectURL(new Blob([economyCsv([series])],{type:'text/csv;charset=utf-8;'}));
    const link=document.createElement('a');link.href=url;link.download=`tm26-${series.id.replace(/[^a-zA-Z0-9_-]/g,'_')}-${series.country}.csv`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <dialog ref={dialog} className={styles.detailDialog} aria-labelledby={title} onClose={onClose}>
    <header className={styles.detailHeader}><div><h2 id={title}>{series.name}</h2><span>{economyCountry(series.country)} · {series.unit||'단위 미제공'} · {economyFrequency(series.frequency)}</span></div><button type="button" className="eco-button" aria-label="지표 상세 닫기" autoFocus onClick={()=>dialog.current?.close()}><X size={16}/></button></header>
    <div className={styles.detailMetrics}><strong>{economyNumber(series.value)} <small>{series.unit}</small></strong><span>직전 관측 {economyNumber(series.previous)}</span><span>변화 {typeof series.change==='number'&&series.change>0?'+':''}{economyNumber(series.change)} {series.change===null?'':economyChangeUnit(series.unit)}</span><span>기준 {series.asOf||'—'}</span></div>
    {series.status==='stale'?<p className="eco-alert">이전에 확보한 자료입니다. 기준일을 확인해 주세요.</p>:null}
    {series.status==='unavailable'&&series.note?<p className={styles.detailNote}>{series.note}</p>:null}
    <div className={styles.detailActions}><div className="eco-segment" aria-label="지표 상세 표시 방식"><button type="button" aria-pressed={display==='chart'} onClick={()=>setDisplay('chart')}><ChartIcon size={13}/> 차트</button><button type="button" aria-pressed={display==='table'} onClick={()=>setDisplay('table')}><Table2 size={13}/> 표</button></div><button type="button" className="eco-button" disabled={!hasPoints} onClick={exportCsv}><Download size={13}/> CSV</button></div>
    {!hasPoints?<p className="eco-empty">기간별 관측 자료가 없습니다.</p>:display==='chart'?<div className="eco-chart" role="img" aria-label={`${series.name} 추이. 표에서 자세한 값을 확인할 수 있습니다.`}><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{top:16,right:24,bottom:4,left:4}}><CartesianGrid stroke="#292b30" strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" tick={{fill:'#92959e',fontSize:10}} minTickGap={36}/><YAxis tick={{fill:'#92959e',fontSize:10}} width={78} tickFormatter={(value:number)=>economyNumber(value,true)} domain={['auto','auto']}/><Tooltip contentStyle={{background:'#15171c',border:'1px solid #45403a',fontSize:12}} formatter={value=>[`${economyNumber(typeof value==='number'?value:null)} ${series.unit}`,series.name]}/><Line dataKey="value" name={series.name} stroke="#ffad33" strokeWidth={2} dot={points.length<3} connectNulls={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>:<div className={styles.detailTable}><table className="eco-table"><caption>{series.name} · {series.unit}</caption><thead><tr><th scope="col">기준일</th><th scope="col">값</th></tr></thead><tbody>{[...points].reverse().map(point=><tr key={point.date}><th scope="row">{point.date}</th><td>{economyNumber(point.value)}</td></tr>)}</tbody></table></div>}
  </dialog>;
}

"use client";
import {useMemo,useState} from 'react';
import {sectorCountSeries,type SectorCountPoint} from '@/lib/sector-counts';
import {Panel,Message,fmt,type Row} from './TradingCommon';
import css from './ScreeningLayout.module.css';
const label=(name:string)=>name==='-'?'미분류':name;
export default function SectorRsPanel({rows,stamp,history=[],onSelect}:{rows:Row[];market:'KR'|'US';stamp?:string;history?:SectorCountPoint[];onSelect:(name:string)=>void}){
 const [selected,setSelected]=useState(''),[hover,setHover]=useState('');
 const {points,series,start,end}=useMemo(()=>sectorCountSeries(rows,stamp||'',history),[rows,stamp,history]);
 const focus=hover||selected;
 const maximum=Math.max(0,...series.flatMap(s=>s.values.map(p=>p.value??0))),step=Math.max(1,Math.ceil(maximum/4)),ceiling=step*4;
 const x=(stamp:string)=>54+(Date.parse(stamp.slice(0,10)+'T00:00:00Z')-start)/Math.max(1,end-start)*922,y=(v:number)=>272-v/ceiling*252;
 const path=(values:{stamp:string;value:number|null}[])=>{let connected=false;return values.map(p=>{if(p.value===null){connected=false;return '';}const next=(connected?'L':'M')+x(p.stamp)+','+y(p.value);connected=true;return next;}).join(' ');};
 const focused=series.find(s=>s.name===focus);
 return <Panel title="업종별 스크리너 통과 추이" className={css.sectors} actions={<span>{series.length}개 업종 · 최근 30일</span>}>
 {!series.length?<Message>업종별 통과 자료가 없습니다.</Message>:<div className={css.sectorSplit}>
 <div className={css.rsList}><div className={css.rsListHeading}><span>업종</span><span>통과 종목 수</span></div>{series.map(s=><button key={s.name} type="button" aria-pressed={selected===s.name} onMouseEnter={()=>setHover(s.name)} onMouseLeave={()=>setHover('')} onFocus={()=>setHover(s.name)} onBlur={()=>setHover('')} onClick={()=>setSelected(selected===s.name?'':s.name)}><span><i style={{display:'inline-block',width:14,borderTop:'3px solid '+s.color,marginRight:7}}/>{label(s.name)}</span><b>{s.count}개</b></button>)}</div>
 <div className={css.rsChart+' '+css.multiSectorChart}><div className={css.rsChartTitle}><span>{focused?`${label(focused.name)} · ${focused.count}개`:'전체 업종 · 통과 종목 수 · 최근 30일'}</span>{focused&&focused.name!=='-'&&<button type="button" onClick={()=>onSelect(focused.name)}>통과 종목 보기</button>}</div>
 {points.length<2&&<Message>추이 기록이 부족합니다 · {points.length}일 관측</Message>}
 <svg viewBox="0 0 1000 300" preserveAspectRatio="none" role="img" aria-label="전체 업종 최근 30일 스크리너 통과 종목 수 비교">
 {[0,1,2,3,4].map(i=><g key={i}><text x="45" y={y(i*step)+4} textAnchor="end">{i*step}개</text><line x1="54" x2="976" y1={y(i*step)} y2={y(i*step)} stroke="#333" strokeDasharray="3 4"/></g>)}
 {[...series].sort((a,b)=>Number(a.name===focus)-Number(b.name===focus)).map(s=><g key={s.name} opacity={focus&&focus!==s.name?0.2:1} onMouseEnter={()=>setHover(s.name)} onMouseLeave={()=>setHover('')}>
 <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={focus===s.name?3:1.4} strokeDasharray={s.dash} vectorEffect="non-scaling-stroke"><title>{label(s.name)+' · '+s.values.map(p=>p.stamp.slice(5,10)+': '+(p.value??'—')+'개').join(' / ')}</title></path>
 {s.values.map(p=>p.value===null||(focus?focus!==s.name:points.length>1)?null:<circle key={p.stamp} cx={x(p.stamp)} cy={y(p.value)} r={focus===s.name?3:2} fill={s.color}><title>{p.stamp+' · '+label(s.name)+' '+fmt(p.value,0)+'개'}</title></circle>)}
 </g>)}
 <text x="54" y="295">{Number.isFinite(start)?new Date(start).toISOString().slice(5,10):''}</text><text x="976" y="295" textAnchor="end">{points.at(-1)?.stamp.slice(5,10)}</text></svg>
 </div></div>}
 </Panel>;
}

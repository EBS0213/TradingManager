"use client";

import {useMemo,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {useQuery} from '@tanstack/react-query';
import {SlidersHorizontal} from 'lucide-react';
import type {EconomySeries} from './types';
import {economyCountry,economyFrequency,economyNumber,economyQueryOptions} from './types';
import {ECONOMY_CATEGORIES,ECONOMY_GROUPS,economyDashboardGroup,economyKey,filterEconomyDashboard,groupEconomyDashboard,economyChangeUnit} from './dashboard.mjs';
import styles from './EconomyHub.module.css';
import AutoDataStatus from './AutoDataStatus';

const SeriesDetail=dynamic(()=>import('./EconomySeriesDetail'),{loading:()=> <p role="status">지표 상세를 불러오는 중입니다…</p>});
const EMPTY_SERIES:EconomySeries[]=[];
const STATUS_LABEL={available:'제공 중',stale:'이전 자료',unavailable:'미제공'};
const ALL_CATEGORIES=ECONOMY_CATEGORIES.map(category=>category.id);
function observedAt(value:string|null) {
  if(!value)return '—';
  return value.includes('T')?new Date(value).toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,16)+' KST':value;
}
function SeriesCard({series,onSelect}:{series:EconomySeries;onSelect:(element:HTMLButtonElement)=>void}) {
  const future=series.asOf&&Date.parse(series.asOf)>Date.now()+86400000;
  return <button type="button" className={styles.metric} onClick={event=>onSelect(event.currentTarget)} aria-haspopup="dialog">
    <span className={styles.metricTop}><span>{series.name}</span><span className={`eco-status eco-status-${series.status}`}>{future?'미래 기준':STATUS_LABEL[series.status]}</span></span>
    <span className={styles.context}>{economyCountry(series.country)} · {economyFrequency(series.frequency)}</span>
    <strong>{economyNumber(series.value)} <small>{series.unit||'단위 미제공'}</small></strong>
    <span className={styles.change}>{series.change===null?'직전 비교 없음':`변화 ${series.change>0?'+':''}${economyNumber(series.change)} ${economyChangeUnit(series.unit)}`}</span>
    <span className={styles.observed}>기준 {observedAt(series.asOf)}</span>
  </button>;
}

export function EconomyHub({initialSeries=''}:{initialSeries?:string}={}) {
  const query=useQuery({...economyQueryOptions('overview'),refetchInterval:15*60000});
  const [categories,setCategories]=useState<string[]>(ALL_CATEGORIES);
  const [group,setGroup]=useState('all'),[country,setCountry]=useState('all');
  const [status,setStatus]=useState('all'),[search,setSearch]=useState(''),[sort,setSort]=useState('availability');
  const [selectedKey,setSelectedKey]=useState(initialSeries);
  const opener=useRef<HTMLButtonElement|null>(null);
  const closeDetail=()=>{setSelectedKey('');requestAnimationFrame(()=>{if(opener.current?.isConnected)opener.current.focus();});};
  const allSeries=query.data?.series||EMPTY_SERIES;
  const filtered=useMemo(()=>filterEconomyDashboard(allSeries,{categories,group,country,status,search,sort}) as EconomySeries[],[allSeries,categories,group,country,status,search,sort]);
  const sections=useMemo(()=>groupEconomyDashboard(filtered),[filtered]);
  const countries=useMemo(()=>[...new Set(allSeries.map(row=>row.country))].sort((a,b)=>economyCountry(a).localeCompare(economyCountry(b),'ko')),[allSeries]);
  const counts=useMemo(()=>allSeries.reduce<Record<string,number>>((sum,row)=>{const category=economyDashboardGroup(row).category;sum[category]=(sum[category]||0)+1;return sum;},{}),[allSeries]);
  const selected=allSeries.find(row=>economyKey(row)===selectedKey||row.id===selectedKey);
  const staleCount=filtered.filter(row=>row.status==='stale').length,unavailableCount=filtered.filter(row=>row.status==='unavailable').length;
  const reset=()=>{setCategories(ALL_CATEGORIES);setGroup('all');setCountry('all');setStatus('all');setSearch('');setSort('availability');};
  const toggleCategory=(id:string)=>{setCategories(old=>old.includes(id)?old.filter(value=>value!==id):[...old,id]);setGroup('all');};
  return <div className={`tm-economy eco-hub ${styles.workbench}`} role="region" aria-label="경제지표 대시보드">
    <div className={styles.heading}><div><h1>경제지표 대시보드</h1><span>ECONOMICS</span></div></div>
    <section className={styles.filters} aria-label="대시보드 필터">
      <div className={styles.categoryRow}><span className={styles.filterLabel}><SlidersHorizontal size={13}/> 분류 필터</span><button type="button" className="eco-button" aria-pressed={categories.length===ALL_CATEGORIES.length} onClick={()=>{setCategories(ALL_CATEGORIES);setGroup('all');}}>전체</button>{ECONOMY_CATEGORIES.map(category=><label key={category.id} className={styles.categoryOption}><input type="checkbox" checked={categories.includes(category.id)} onChange={()=>toggleCategory(category.id)}/>{category.name}<small>{counts[category.id]||0}</small></label>)}</div>
      <div className={styles.toolbar}><label className={styles.search}>지표 검색<input type="search" aria-label="경제지표 검색" value={search} onChange={event=>setSearch(event.target.value)} placeholder="지표명 · 코드"/></label><label>항목<select aria-label="경제지표 항목" value={group} onChange={event=>setGroup(event.target.value)}><option value="all">전체 항목</option>{ECONOMY_GROUPS.filter(item=>categories.includes(item.category)).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>국가<select aria-label="경제지표 국가" value={country} onChange={event=>setCountry(event.target.value)}><option value="all">전체 국가</option>{countries.map(code=><option key={code} value={code}>{economyCountry(code)}</option>)}</select></label><label>상태<select aria-label="경제지표 상태" value={status} onChange={event=>setStatus(event.target.value)}><option value="all">전체 상태</option>{Object.entries(STATUS_LABEL).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>정렬<select aria-label="경제지표 정렬" value={sort} onChange={event=>setSort(event.target.value)}><option value="availability">값 있는 자료 우선</option><option value="name">지표명</option><option value="date">최근 기준일</option></select></label><button type="button" className="eco-button" onClick={reset}>필터 초기화</button></div>
    </section>
    <div className={styles.summary} aria-live="polite"><span><strong>{filtered.length}</strong> / {allSeries.length}개 지표 · 제공 {filtered.length-staleCount-unavailableCount} · 이전 자료 {staleCount} · 미제공 {unavailableCount}</span><AutoDataStatus/></div>
    {query.isError?<div className="eco-alert" role="alert">경제 데이터 조회 지연 · 자동으로 재시도합니다.</div>:null}
    {query.data?.errors.length?<div className="eco-alert" role="status">일부 지표 조회 실패 · 확보된 자료와 미제공 상태를 표시합니다.</div>:null}
    {query.isPending?<p className="eco-loading" role="status">경제지표를 불러오는 중입니다.</p>:sections.length?sections.map(section=><section key={section.id} className={styles.section} aria-label={section.name}><header><h2>{section.name}</h2><span>{section.items.length}개 지표</span></header><div className={styles.grid}>{(section.items as EconomySeries[]).map(row=><SeriesCard key={economyKey(row)} series={row} onSelect={element=>{opener.current=element;setSelectedKey(economyKey(row));}}/>)}</div></section>):<div className="eco-empty" role="status"><p>조건에 맞는 지표가 없습니다.</p><button type="button" className="eco-button" onClick={reset}>필터 초기화</button></div>}
    {selected?<SeriesDetail key={economyKey(selected)} series={selected} onClose={closeDetail}/>:null}
  </div>;
}
export default EconomyHub;

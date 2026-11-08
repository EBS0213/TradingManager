'use client';
import {useEffect,useMemo,useRef,useState} from 'react';import dynamic from 'next/dynamic';import {useQuery} from '@tanstack/react-query';import styles from './AviationDesk.module.css';
import {mergeObservations} from '@/lib/aviation/observations.mjs';
import {fetchAviation,aviationRefetchInterval} from '@/lib/aviation/refresh.mjs';
export type Aircraft={id:string;callsign:string;registration:string;aircraft:string;lat:number;lon:number;asOf:string;ground:boolean;altitude:number|null;speed:number|null;heading:number|null;verticalRate:number|null;squawk:string;category:string;source:string;stale:boolean};
type Result={ok:boolean;status:string;aircraft:Aircraft[];updatedAt:string;coverage?:{lat:number;lon:number;radius:number}[];error?:string};
type Point={lat:number;lon:number;asOf:string};
const Map=dynamic(()=>import('./AviationMap'),{ssr:false,loading:()=> <div className={styles.mapLoading}>지도 로딩 중…</div>});
const areas:Record<string,{lat:number,lon:number}>={'울산·부산':{lat:35.54,lon:129.32},'인천·서울':{lat:37.46,lon:126.44},'도쿄':{lat:35.55,lon:139.78},'싱가포르':{lat:1.35,lon:103.99},'런던':{lat:51.47,lon:-.45},'뉴욕':{lat:40.64,lon:-73.78},'로스앤젤레스':{lat:33.94,lon:-118.41}};
const n=(v:number|null)=>v===null?'—':v.toLocaleString('en-US',{maximumFractionDigits:1});
const clock=(s:string)=>new Date(s).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});
export default function AviationDesk(){
 const [center,setCenter]=useState(areas['울산·부산']),[pendingCenter,setPendingCenter]=useState(center),[queryCenter,setQueryCenter]=useState(center),[q,setQ]=useState(''),[phase,setPhase]=useState('all'),[alt,setAlt]=useState('all'),[kind,setKind]=useState(''),[id,setId]=useState<string|null>(null),[follow,setFollow]=useState(false),[paused,setPaused]=useState(false),[metric,setMetric]=useState(false),[tracks,setTracks]=useState<Record<string,Point[]>>({});
 const [listOpen,setListOpen]=useState(false);
 useEffect(()=>{if(paused)return;const timer=setTimeout(()=>setQueryCenter({lat:Math.round(pendingCenter.lat),lon:Math.round(pendingCenter.lon)}),800);return()=>clearTimeout(timer)},[pendingCenter,paused]);
 const container=useRef<HTMLDivElement>(null);
 const [retained,setRetained]=useState<Aircraft[]>([]);
 const query=useQuery<Result>({queryKey:['aviation',Math.round(queryCenter.lat),Math.round(queryCenter.lon)],queryFn:({signal})=>fetchAviation(`/api/terminal/aviation?lat=${queryCenter.lat}&lon=${queryCenter.lon}&wide=1`,signal),refetchInterval:paused?false:state=>aviationRefetchInterval(state.state.data),staleTime:0,refetchOnMount:'always',placeholderData:previous=>previous,retry:1});
 // Observation lifetime belongs to the aircraft, not to a rounded map query key.
 // A new area's pending/empty response must not erase overlapping observations.
 useEffect(()=>{if(!query.data||query.isPlaceholderData)return;setRetained(previous=>mergeObservations(previous,query.data!.aircraft))},[query.data,query.isPlaceholderData]);
 useEffect(()=>{if(paused)return;const resume=()=>{if(!document.hidden)void query.refetch()};document.addEventListener('visibilitychange',resume);window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);return()=>{document.removeEventListener('visibilitychange',resume);window.removeEventListener('focus',resume);window.removeEventListener('pageshow',resume)}},[paused,query.refetch]);
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{if(paused)return;const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer)},[paused]);
 const observations=useMemo(()=>retained.filter(a=>now-Date.parse(a.asOf)<300000).map(a=>({...a,stale:a.stale||now-Date.parse(a.asOf)>60000})),[retained,now]);
 const selected=observations.find(a=>a.id===id)||null;
 useEffect(()=>{setTracks(previous=>{const next:Record<string,Point[]>={};for(const a of observations){const old=previous[a.id]||[],last=old.at(-1);next[a.id]=last?.asOf===a.asOf?old:[...old,{lat:a.lat,lon:a.lon,asOf:a.asOf}].slice(-60)}return next})},[observations]);
 const rows=useMemo(()=>{const search=q.trim().toLowerCase();return observations.filter(a=>(!search||[a.callsign,a.id,a.registration].some(s=>s.toLowerCase().includes(search)))&&(!kind||a.aircraft.toLowerCase().includes(kind.toLowerCase()))&&(phase==='all'||(phase==='ground'?a.ground:!a.ground))&&(alt==='all'||(a.altitude!==null&&(alt==='high'?a.altitude>=30000:a.altitude<10000)))).sort((a,b)=>a.callsign.localeCompare(b.callsign))},[observations,q,kind,phase,alt]);
 const mapAircraft=selected?[selected]:rows;
 const staleCount=observations.filter(a=>a.stale).length;
 const status=(query.isPending?'항공 데이터 조회 중':query.isError||query.data?.status==='unavailable'?'조회 실패 · 이전 자료 확인':query.data?.status==='pending'?'수집 대기 중 · 잠시 후 갱신':query.data?.status==='stale'?'이전 관측 · 최근 수집 대기':!observations.length?'수신된 항공기 없음':`최근 관측 ${observations.length}대${query.data?.status==='partial'?' · 일부 영역 수신 실패':''}`)+(staleCount?` · 이전 관측 ${staleCount}대`:'');
 function region(label:string){const next=areas[label];if(next){setCenter(next);setPendingCenter(next);setQueryCenter(next);setId(null)}}
 return <div ref={container} className={`fc-desk ${styles.desk}`}>
  <div className="fc-desk-title"><h1>항공 추적</h1><button className="fc-button" disabled={query.isFetching} onClick={()=>query.refetch()}>새로고침</button></div>
  <div className={`fc-panel ${styles.toolbar}`}>
   <input aria-label="항공편 검색" placeholder="항공편 · 호출부호 · 등록번호 · ICAO 검색" value={q} onChange={e=>setQ(e.target.value)}/>
   <input aria-label="기종 검색" placeholder="기종 (B738, A320…)" value={kind} onChange={e=>setKind(e.target.value)} style={{maxWidth:170}}/>
   <select aria-label="항공 지역" defaultValue="울산·부산" onChange={e=>region(e.target.value)}>{Object.keys(areas).map(a=><option key={a}>{a}</option>)}</select>
   <select aria-label="비행 상태" value={phase} onChange={e=>setPhase(e.target.value)}><option value="all">전체</option><option value="airborne">비행 중</option><option value="ground">지상</option></select>
   <select aria-label="고도 필터" value={alt} onChange={e=>setAlt(e.target.value)}><option value="all">전체 고도</option><option value="low">10,000 ft 미만</option><option value="high">30,000 ft 이상</option></select>
   <button className="fc-button" onClick={()=>{setQueryCenter({lat:Math.round(pendingCenter.lat*10)/10,lon:Math.round(pendingCenter.lon*10)/10});setId(null)}}>이 위치 조회</button><button className="fc-button" onClick={()=>setListOpen(v=>!v)}>{listOpen?'목록 숨기기':'목록 표시'}</button>
   <button className="fc-button" aria-pressed={paused} onClick={()=>setPaused(x=>!x)}>{paused?'자동 갱신 재개':'갱신 일시정지'}</button>
   <label><input type="checkbox" checked={metric} onChange={e=>setMetric(e.target.checked)}/> km/h · m</label>
   <span role="status">{status}{query.isFetching?' · 갱신 중':''}{paused?' · 일시정지':''}</span>
  </div>
  <div className={styles.main}><section className={`fc-panel ${styles.mapPanel}`}><div className="fc-panel-head"><h2>항공기 위치</h2>{id&&<button className="fc-button" onClick={()=>setId(null)}>선택 해제</button>}<span>지도 이동 시 주변 9개 영역 자동 조회 · {query.data?.updatedAt?clock(query.data.updatedAt)+' KST':'—'}</span></div><Map coverage={query.data?.coverage||[]} aircraft={mapAircraft} selected={selected} onSelect={setId} center={center} onCenter={setPendingCenter} track={selected?tracks[selected.id]||[]:[]} follow={follow}/></section>
   {(listOpen||selected)&&<aside className={`fc-panel ${styles.side}`}><div className="fc-panel-head"><h2>항공편 목록</h2><span>{rows.length} AIRCRAFT</span></div><div className={styles.list}>{rows.slice(0,200).map(a=><button key={a.id} className={a.id===id?styles.active:''} onClick={()=>setId(a.id)}><strong>{a.callsign}</strong><span>{a.aircraft||'기종 미수신'} · {a.registration||a.id}</span><small>{a.ground?'지상':n(a.altitude)+' ft'} · {n(a.speed)} kn{a.stale?' · 이전 관측':''}</small></button>)}{!rows.length&&<p className={styles.empty}>{query.isPending?status:query.isError?'데이터를 조회하지 못했습니다.':'현재 영역·검색 조건에 항공기가 없습니다.'}</p>}</div>
   <div className="fc-panel-head"><h2>항공기 상세</h2>{selected&&<button className="fc-button" onClick={()=>setId(null)}>닫기</button>}</div>
   {selected?<div className={styles.detail}><h3>{selected.callsign}</h3><label><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/> 선택 항공기 따라가기</label><dl>{[['등록번호',selected.registration||'—'],['ICAO',selected.id],['기종',selected.aircraft||'—'],['고도',n(selected.altitude===null?null:selected.altitude*(metric?.3048:1))+(metric?' m':' ft')],['대지속도',n(selected.speed===null?null:selected.speed*(metric?1.852:1))+(metric?' km/h':' kn')],['방향',n(selected.heading)+'°'],['수직속도',n(selected.verticalRate)+' ft/min'],['트랜스폰더',selected.squawk||'—'],['위치',`${selected.lat.toFixed(4)}, ${selected.lon.toFixed(4)}`],['관측 · KST',clock(selected.asOf)+(selected.stale?' · 이전 관측':'')],['화면 관측 항적',`${tracks[selected.id]?.length||0}개 지점`]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><p>출발·도착 공항과 운항 스케줄은 현재 데이터에 포함되지 않습니다.</p></div>:<p className={styles.empty}>지도 또는 목록에서 항공기를 선택하세요.</p>}
   </aside>}</div>
  <section className={`fc-panel ${styles.records}`}><div className="fc-panel-head"><h2>관측 목록</h2><span>1분 확인 · 목록 최대 200대 · {id?'지도는 선택 항공기만 표시':'지도는 검색 조건에 맞는 항공기 표시'}</span></div><div className="fc-table-wrap"><table className="fc-table"><thead><tr>{['호출부호','기종','등록번호','고도 (ft)','대지속도 (kn)','상태','관측 · KST'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice(0,200).map(a=><tr key={a.id} onClick={()=>setId(a.id)}><td><button className="fc-button" onClick={()=>setId(a.id)}>{a.callsign}</button></td><td>{a.aircraft||'—'}</td><td>{a.registration||'—'}</td><td>{n(a.altitude)}</td><td>{n(a.speed)}</td><td>{a.stale?'이전 관측':a.ground?'지상':'비행 중'}</td><td>{clock(a.asOf)}</td></tr>)}</tbody></table></div></section>
 </div>;
}

'use client';
import {useEffect,useRef,useState} from 'react';
import type * as Leaflet from 'leaflet';
import type {Vessel} from './MaritimeDesk';
import styles from './MaritimeDesk.module.css';
import 'leaflet/dist/leaflet.css';
import {createVesselCanvas,VESSEL_COLORS} from './vesselCanvas';
export const REGIONS:Record<string,{label:string,lat:number,lon:number,zoom:number}>={atlantic:{label:'대서양',lat:25,lon:-12,zoom:4},world:{label:'세계',lat:20,lon:0,zoom:2},korea:{label:'한국',lat:35,lon:128,zoom:6},suez:{label:'수에즈',lat:30.1,lon:32.5,zoom:7},hormuz:{label:'호르무즈',lat:26.5,lon:56.3,zoom:7},malacca:{label:'말라카',lat:3,lon:101,zoom:6},panama:{label:'파나마',lat:9.1,lon:-79.7,zoom:7}};
const COLORS=VESSEL_COLORS;
export default function MaritimeMap({vessels,onViewport,selected,onSelect,region,showTracks}:{onViewport:(value:string)=>void,vessels:Vessel[],selected:Vessel|null,onSelect:(id:string)=>void,region:string,showTracks:boolean}){
 const host=useRef<HTMLDivElement>(null),map=useRef<Leaflet.Map|null>(null),layer=useRef<Leaflet.LayerGroup|null>(null),sdk=useRef<typeof Leaflet|null>(null),select=useRef(onSelect);
 select.current=onSelect;
 const canvas=useRef<ReturnType<typeof createVesselCanvas>|null>(null);
 const centered=useRef<string|null>(null);
 const viewport=useRef(onViewport);viewport.current=onViewport;
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let disposed=false;let observer:ResizeObserver|undefined;
  import('leaflet').then(L=>{
   if(disposed||!host.current)return;sdk.current=L;
   const m=L.map(host.current,{worldCopyJump:false,minZoom:2,maxZoom:16,maxBounds:[[-85,-180],[85,180]],maxBoundsViscosity:1}).setView([25,-12],4);map.current=m;
   L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',{noWrap:true,maxZoom:16,maxNativeZoom:13,attribution:'Tiles &copy; Esri · HERE · Garmin · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',className:styles.tiles,keepBuffer:1,updateWhenIdle:true}).on('tileerror',()=>setError('일부 지도 타일을 불러오지 못했습니다.')).addTo(m);
   L.control.scale({imperial:false}).addTo(m);
   for(const r of Object.values(REGIONS).filter(r=>['수에즈','호르무즈','말라카','파나마'].includes(r.label))){
    const text=document.createElement('span');text.textContent=r.label+' · 해역 기준점';
    L.circleMarker([r.lat,r.lon],{radius:5,color:'#d79945',weight:1,fillOpacity:.25}).bindTooltip(text).addTo(m);
   }
   layer.current=L.layerGroup().addTo(m);
   canvas.current=createVesselCanvas(L,m,id=>select.current(id));
   let timer:ReturnType<typeof setTimeout>;
   const report=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(disposed)return;const b=m.getBounds(),wrap=(n:number)=>((n+180)%360+360)%360-180;const world=b.getEast()-b.getWest()>=360;viewport.current(new URLSearchParams({bounds:[Math.max(-90,b.getSouth()),world?-180:wrap(b.getWest()),Math.min(90,b.getNorth()),world?180:wrap(b.getEast())].map(n=>n.toFixed(4)).join(','),zoom:String(m.getZoom()),region:Object.entries(REGIONS).find(([,r])=>Math.abs(m.getCenter().lat-r.lat)<.15&&Math.abs(m.getCenter().lng-r.lon)<.15&&m.getZoom()===Math.max(m.getMinZoom(),r.zoom))?.[0]||'custom'}).toString())},250)};
   m.on('moveend',report);report();
   const resize=()=>{m.invalidateSize();const minimum=Math.max(2,Math.ceil(Math.log2(Math.max(m.getSize().x,256)/256)));m.setMinZoom(minimum);if(m.getZoom()<minimum)m.setZoom(minimum)};
   observer=new ResizeObserver(resize);observer.observe(host.current);setReady(true);
  }).catch(()=>setError('지도를 불러오지 못했습니다. 페이지를 새로고침해 주세요.'));
  return()=>{disposed=true;observer?.disconnect();canvas.current?.destroy();canvas.current=null;map.current?.remove();map.current=null;layer.current=null};
 },[]);
 useEffect(()=>{
  if(!ready||!sdk.current||!layer.current)return;const L=sdk.current;layer.current.clearLayers();
  canvas.current?.setData(vessels,selected?.mmsi||null);
  if(showTracks&&selected&&selected.track.length>1){
   let segment:Leaflet.LatLngTuple[]=[];
   for(const p of selected.track){if(segment.length&&Math.abs(segment.at(-1)![1]-p.lon)>180){if(segment.length>1)L.polyline(segment,{color:'#ffb74d',weight:2}).addTo(layer.current);segment=[]}segment.push([p.lat,p.lon])}
   if(segment.length>1)L.polyline(segment,{color:'#ffb74d',weight:2}).addTo(layer.current);
  }
 },[ready,vessels,selected,showTracks]);
 useEffect(()=>{const r=REGIONS[region];if(ready&&r)map.current?.setView([r.lat,r.lon],r.zoom)},[ready,region]);
 useEffect(()=>{if(ready&&selected&&centered.current!==selected.mmsi){centered.current=selected.mmsi;if(!map.current?.getBounds().contains([selected.lat,selected.lon]))map.current?.panTo([selected.lat,selected.lon])}if(!selected)centered.current=null},[ready,selected?.mmsi]);
 return <div className={styles.mapWrap}><div ref={host} className={styles.map} aria-label="선박 위치 지도"/>{error&&<div className={styles.mapError} role="status">{error}</div>}<div className={styles.legend}><span>▲ 이동 · ● 저속/정지 · ○ 속력 미수신</span>{Object.entries(COLORS).map(([key,color])=><span key={key}><i style={{background:color}}/>{({cargo:'화물선',tanker:'유조선',passenger:'여객선',fishing:'어선',other:'기타'} as Record<string,string>)[key]}</span>)}</div></div>;
}

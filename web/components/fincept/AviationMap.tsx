'use client';
import {useEffect,useRef,useState} from 'react';import type * as Leaflet from 'leaflet';import type {Aircraft} from './AviationDesk';import styles from './AviationDesk.module.css';import 'leaflet/dist/leaflet.css';import {createAircraftCanvas} from './aircraftCanvas';
import {trackSegments} from '@/lib/aviation/tracks.mjs';
export default function AviationMap({coverage,aircraft,selected,onSelect,center,onCenter,track,trailStatus,follow}:{coverage:{lat:number;lon:number;radius:number}[];aircraft:Aircraft[],selected:Aircraft|null,onSelect:(id:string)=>void,center:{lat:number,lon:number},onCenter:(c:{lat:number,lon:number})=>void,track:{lat:number,lon:number,asOf:string}[],trailStatus:string,follow:boolean}){
 const host=useRef<HTMLDivElement>(null),map=useRef<Leaflet.Map|null>(null),layer=useRef<Leaflet.LayerGroup|null>(null),sdk=useRef<typeof Leaflet|null>(null),select=useRef(onSelect),move=useRef(onCenter);select.current=onSelect;move.current=onCenter;
 const canvas=useRef<ReturnType<typeof createAircraftCanvas>|null>(null);
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let disposed=false,observer:ResizeObserver|undefined;import('leaflet').then(L=>{
  if(disposed||!host.current)return;sdk.current=L;const m=L.map(host.current,{worldCopyJump:false,inertia:false,minZoom:6,maxZoom:6,zoomControl:false,scrollWheelZoom:false,doubleClickZoom:false,touchZoom:false,boxZoom:false,keyboard:false,maxBounds:[[-85,-180],[85,180]],maxBoundsViscosity:1}).setView([35.54,129.32],6);map.current=m;canvas.current=createAircraftCanvas(L,m,id=>select.current(id));
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://adsb.fi/">adsb.fi</a>',noWrap:true,keepBuffer:1,updateWhenIdle:true}).on('tileerror',()=>setError('일부 지도 타일 로딩 실패')).addTo(m);
  L.control.scale({imperial:false}).addTo(m);layer.current=L.layerGroup().addTo(m);m.on('moveend',()=>{const c=m.getCenter();move.current({lat:Math.max(-85,Math.min(85,c.lat)),lon:((c.lng+180)%360+360)%360-180})});observer=new ResizeObserver(()=>{m.invalidateSize()});observer.observe(host.current);setReady(true);
 }).catch(()=>setError('지도 로딩 실패'));return()=>{disposed=true;observer?.disconnect();canvas.current?.destroy();map.current?.remove();map.current=null;layer.current=null}},[]);
 useEffect(()=>{if(!ready||!sdk.current||!layer.current)return;const L=sdk.current;layer.current.clearLayers();for(const c of coverage)L.circle([c.lat,c.lon],{radius:c.radius*1852,color:"#5488a1",weight:1,opacity:.18,fill:false,interactive:false}).addTo(layer.current);
  canvas.current?.setData(aircraft,selected?.id||null);
  for(const segment of trackSegments(track)){
   const points:Leaflet.LatLngTuple[]=segment.map(p=>[p.lat,p.lon]);
   L.polyline(points,{color:'#10212b',weight:6,opacity:.75,interactive:false}).addTo(layer.current);
   L.polyline(points,{color:'#35bfff',weight:3,opacity:1,interactive:false,className:'aviation-track'}).addTo(layer.current);
   L.circleMarker(points[0],{radius:3,color:'#fff',weight:1,fillColor:'#35bfff',fillOpacity:1,interactive:false}).addTo(layer.current);
  }
 },[aircraft,selected,track,ready,coverage]);
 useEffect(()=>{if(ready)map.current?.setView([center.lat,center.lon],6)},[center,ready]);
 useEffect(()=>{if(ready&&selected)map.current?.panTo([selected.lat,selected.lon])},[ready,selected?.id]);
 useEffect(()=>{if(ready&&follow&&selected)map.current?.panTo([selected.lat,selected.lon])},[ready,follow,selected]);
 return <div className={styles.mapWrap}><div ref={host} className={styles.map} aria-label="항공기 위치 지도"/>{selected&&<div className={styles.trailStatus} role="status"><span aria-hidden="true">━</span> {selected.callsign} · {trailStatus}</div>}{error&&<div className={styles.mapError}>{error}</div>}</div>;
}

import type * as Leaflet from 'leaflet';
import type {Aircraft} from './AviationDesk';
export const VESSEL_COLORS:Record<string,string>={cargo:'#29e68c',tanker:'#ff665b',passenger:'#9b8aff',fishing:'#60caff',other:'#b3bdca'};
/** One canvas for all observed ships; screen-space hit buckets avoid DOM markers and full scans on hover. */
export function createAircraftCanvas(L:typeof Leaflet,map:Leaflet.Map,onSelect:(id:string)=>void){
 const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','개별 항공기 위치');canvas.dataset.aircraftCanvas='true';
 Object.assign(canvas.style,{position:'absolute',inset:'0',zIndex:'450',pointerEvents:'none'});map.getContainer().appendChild(canvas);
 let vessels:Aircraft[]=[],selected:string|null=null,frame=0,disposed=false;
 type Hit={x:number;y:number;v:Aircraft};let buckets=new Map<string,Hit[]>();
 const tooltip=L.tooltip({direction:'top',offset:[0,-8],opacity:.95});let hovered='';
 function draw(){
  frame=0;if(disposed)return;const size=map.getSize(),dpr=Math.min(window.devicePixelRatio||1,2),ctx=canvas.getContext('2d');if(!ctx)return;
  canvas.width=Math.round(size.x*dpr);canvas.height=Math.round(size.y*dpr);canvas.style.width=size.x+'px';canvas.style.height=size.y+'px';ctx.scale(dpr,dpr);buckets=new Map();
  const z=map.getZoom(),world=map.options.crs!.scale(z),center=map.getCenter().lng,r=z<=3?7:z<=5?9:11;let drawn=0;
  // Draw one geographic world only; never duplicate a vessel across repeated tile worlds.
  for(const v of vessels){
   const p=map.latLngToContainerPoint([v.lat,v.lon]);if(p.y< -12||p.y>size.y+12)continue;
   if(p.x< -12||p.x>size.x+12)continue;const first=0,last=0;
   for(let copy=first;copy<=last;copy++){
    const x=p.x+copy*world,y=p.y,color=v.ground?'#98a5b8':'#ffe000';
    ctx.save();ctx.translate(x,y);ctx.globalAlpha=v.stale?.5:1;ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=.7;
    ctx.rotate((v.heading??0)*Math.PI/180);ctx.scale(r/14,r/14);ctx.fillStyle=color;ctx.strokeStyle='#6d601a';ctx.lineWidth=.8;
    const plane=new Path2D('M0 -13L2 -10V-4L12 3V6L2 2V9L6 12V13L0 11L-6 13V12L-2 9V2L-12 6V3L-2 -4V-10Z');ctx.fill(plane);ctx.stroke(plane);
    ctx.restore();if(v.id===selected){ctx.beginPath();ctx.arc(x,y,r+4,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke()}
    const key=Math.floor(x/16)+':'+Math.floor(y/16),cell=buckets.get(key)||[];cell.push({x,y,v});buckets.set(key,cell);drawn++;
   }
  }
  canvas.dataset.drawn=String(drawn);canvas.dataset.vessels=String(vessels.length);
 }
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(draw)};
 const hit=(p:Leaflet.Point)=>{let best:Hit|undefined,distance=81;const bx=Math.floor(p.x/16),by=Math.floor(p.y/16);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const h of buckets.get((bx+dx)+':'+(by+dy))||[]){const d=(h.x-p.x)**2+(h.y-p.y)**2;if(d<distance){best=h;distance=d}}return best};
 const move=(e:Leaflet.LeafletMouseEvent)=>{const h=hit(e.containerPoint);map.getContainer().style.cursor=h?'pointer':'';if(!h){tooltip.remove();hovered='';return}if(hovered!==h.v.id){const label=document.createElement('span');label.textContent=h.v.callsign+' · '+h.v.id+' · '+(h.v.speed===null?'속력 미수신':h.v.speed+' kn');tooltip.setContent(label);hovered=h.v.id}tooltip.setLatLng(map.containerPointToLatLng([h.x,h.y])).addTo(map)};
 const click=(e:Leaflet.LeafletMouseEvent)=>{const h=hit(e.containerPoint);if(h)onSelect(h.v.id)};
 const hide=()=>{canvas.style.visibility='hidden';tooltip.remove()};const show=()=>{canvas.style.visibility='visible';schedule()};
 map.on('move resize',schedule);map.on('zoomstart',hide);map.on('zoomend moveend',show);map.on('mousemove',move);map.on('click',click);
 return {setData(next:Aircraft[],id:string|null){vessels=next;selected=id;schedule()},destroy(){disposed=true;cancelAnimationFrame(frame);map.off('move resize',schedule);map.off('zoomstart',hide);map.off('zoomend moveend',show);map.off('mousemove',move);map.off('click',click);tooltip.remove();canvas.remove();map.getContainer().style.cursor=''}};
}

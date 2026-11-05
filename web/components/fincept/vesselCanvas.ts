import type * as Leaflet from 'leaflet';
import type {Vessel} from './MaritimeDesk';
export const VESSEL_COLORS:Record<string,string>={cargo:'#29e68c',tanker:'#ff665b',passenger:'#9b8aff',fishing:'#60caff',other:'#b3bdca'};
/** One canvas for all observed ships; screen-space hit buckets avoid DOM markers and full scans on hover. */
export function createVesselCanvas(L:typeof Leaflet,map:Leaflet.Map,onSelect:(id:string)=>void){
 const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','개별 선박 위치');canvas.dataset.vesselCanvas='true';
 Object.assign(canvas.style,{position:'absolute',inset:'0',zIndex:'450',pointerEvents:'none'});map.getContainer().appendChild(canvas);
 let vessels:Vessel[]=[],selected:string|null=null,frame=0,disposed=false;
 type Hit={x:number;y:number;v:Vessel};let buckets=new Map<string,Hit[]>();
 const tooltip=L.tooltip({direction:'top',offset:[0,-8],opacity:.95});let hovered='';
 function draw(){
  frame=0;if(disposed)return;const size=map.getSize(),dpr=Math.min(window.devicePixelRatio||1,2),ctx=canvas.getContext('2d');if(!ctx)return;
  canvas.width=Math.round(size.x*dpr);canvas.height=Math.round(size.y*dpr);canvas.style.width=size.x+'px';canvas.style.height=size.y+'px';ctx.scale(dpr,dpr);buckets=new Map();
  const z=map.getZoom(),world=map.options.crs!.scale(z),center=map.getCenter().lng,r=z<=3?5:z<=5?5.5:6.5;let drawn=0;
  // Draw one geographic world only; never duplicate a vessel across repeated tile worlds.
  for(const v of vessels){
   const p=map.latLngToContainerPoint([v.lat,v.lon]);if(p.y< -12||p.y>size.y+12)continue;
   if(p.x< -12||p.x>size.x+12)continue;const first=0,last=0;
   for(let copy=first;copy<=last;copy++){
    const x=p.x+copy*world,y=p.y,color=VESSEL_COLORS[v.category]||VESSEL_COLORS.other;
    ctx.save();ctx.translate(x,y);ctx.globalAlpha=v.stale?.5:1;ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=.7;
    if(v.speed!==null&&v.speed>1){ctx.rotate((v.heading??v.course??0)*Math.PI/180);ctx.beginPath();ctx.moveTo(0,-r);ctx.lineTo(r*.65,r);ctx.lineTo(0,r*.5);ctx.lineTo(-r*.65,r);ctx.closePath();ctx.fill();ctx.stroke()}
    else{ctx.beginPath();ctx.arc(0,0,r*.55,0,Math.PI*2);if(v.speed!==null)ctx.fill();else ctx.strokeStyle=color;ctx.stroke()}
    ctx.restore();if(v.mmsi===selected){ctx.beginPath();ctx.arc(x,y,r+4,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke()}
    const key=Math.floor(x/16)+':'+Math.floor(y/16),cell=buckets.get(key)||[];cell.push({x,y,v});buckets.set(key,cell);drawn++;
   }
  }
  canvas.dataset.drawn=String(drawn);canvas.dataset.vessels=String(vessels.length);
 }
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(draw)};
 const hit=(p:Leaflet.Point)=>{let best:Hit|undefined,distance=81;const bx=Math.floor(p.x/16),by=Math.floor(p.y/16);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const h of buckets.get((bx+dx)+':'+(by+dy))||[]){const d=(h.x-p.x)**2+(h.y-p.y)**2;if(d<distance){best=h;distance=d}}return best};
 const move=(e:Leaflet.LeafletMouseEvent)=>{const h=hit(e.containerPoint);map.getContainer().style.cursor=h?'pointer':'';if(!h){tooltip.remove();hovered='';return}if(hovered!==h.v.mmsi){const label=document.createElement('span');label.textContent=h.v.name+' · '+h.v.mmsi+' · '+(h.v.speed===null?'속력 미수신':h.v.speed+' kn');tooltip.setContent(label);hovered=h.v.mmsi}tooltip.setLatLng(map.containerPointToLatLng([h.x,h.y])).addTo(map)};
 const click=(e:Leaflet.LeafletMouseEvent)=>{const h=hit(e.containerPoint);if(h)onSelect(h.v.mmsi)};
 const hide=()=>{canvas.style.visibility='hidden';tooltip.remove()};const show=()=>{canvas.style.visibility='visible';schedule()};
 map.on('move resize',schedule);map.on('zoomstart',hide);map.on('zoomend moveend',show);map.on('mousemove',move);map.on('click',click);
 return {setData(next:Vessel[],id:string|null){vessels=next;selected=id;schedule()},destroy(){disposed=true;cancelAnimationFrame(frame);map.off('move resize',schedule);map.off('zoomstart',hide);map.off('zoomend moveend',show);map.off('mousemove',move);map.off('click',click);tooltip.remove();canvas.remove();map.getContainer().style.cursor=''}};
}

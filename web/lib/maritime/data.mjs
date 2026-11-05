export const FREIGHT_INDICES = [
 ['BDI','발틱 건화물','벌크선','pt','daily','Baltic Exchange','https://www.balticexchange.com/'],
 ['BCI','케이프사이즈','벌크선','pt','daily','Baltic Exchange','https://www.balticexchange.com/'],
 ['BPI','파나막스','벌크선','pt','daily','Baltic Exchange','https://www.balticexchange.com/'],
 ['BSI','수프라막스','벌크선','pt','daily','Baltic Exchange','https://www.balticexchange.com/'],
 ['SCFI','상하이 컨테이너','컨테이너','pt','weekly','Shanghai Shipping Exchange Institute','https://en.sse.net.cn/'],
 ['CCFI','중국 컨테이너','컨테이너','pt','weekly','Shanghai Shipping Exchange Institute','https://en.sse.net.cn/'],
 ['FBX','글로벌 컨테이너','컨테이너','USD/FEU','weekly','Freightos Baltic Index','https://fbx.freightos.com/'],
 ['WCI','드류리 컨테이너','컨테이너','USD/FEU','weekly','Drewry','https://www.drewry.co.uk/'],
 ['BDTI','원유 유조선','유조선','pt','daily','Baltic Exchange','https://www.balticexchange.com/'],
 ['BCTI','정제유 유조선','유조선','pt','daily','Baltic Exchange','https://www.balticexchange.com/'],
].map(([code,name,group,unit,frequency,provider,url])=>({code,name,group,unit,frequency,source:{name:provider,url}}))
const finite=value=>(typeof value==='number'||(typeof value==='string'&&value.trim()!==''))&&Number.isFinite(Number(value))?Number(value):null
const bounded=(value,min,max)=>{const n=finite(value);return n!==null&&n>=min&&n<=max?n:null}
const clean=(value,max=120)=>String(value||'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max)
export function observedDate(value,now=Date.now()) {
 const time=Date.parse(value);return Number.isFinite(time)&&time<=now+300000&&time>=Date.UTC(2000,0,1)?new Date(time).toISOString():null
}
export function shipCategory(type){const n=Number(type);return n>=80&&n<=89?'tanker':n>=70&&n<=79?'cargo':n>=60&&n<=69?'passenger':n===30?'fishing':'other'}
export function normalizeVessel(raw,now=Date.now()) {
 const mmsi=String(raw.mmsi??raw.MMSI??'');const lat=bounded(raw.lat??raw.LAT,-90,90),lon=bounded(raw.lon??raw.LON,-180,180)
 const asOf=observedDate(raw.asOf??raw.TIMESTAMP,now)
 if(!/^\d{9}$/.test(mmsi)||lat===null||lon===null||!asOf)return null
 const type=raw.type??raw.SHIPTYPE
 const track=(Array.isArray(raw.track)?raw.track:[]).slice(-200).map(p=>({lat:bounded(p.lat,-90,90),lon:bounded(p.lon,-180,180),asOf:observedDate(p.asOf,now)})).filter(p=>p.lat!==null&&p.lon!==null&&p.asOf&&p.asOf<=asOf).sort((a,b)=>a.asOf.localeCompare(b.asOf))
 return {mmsi,name:clean(raw.name??raw.SHIPNAME)||mmsi,imo:clean(raw.imo??raw.IMO,10),lat,lon,asOf,
  speed:raw.SPEED!==undefined?(bounded(raw.SPEED,0,1022)===null?null:bounded(raw.SPEED,0,1022)/10):bounded(raw.speed,0,102.2),course:bounded(raw.course??raw.COURSE,0,359.9),heading:bounded(raw.heading??raw.HEADING,0,359),type:finite(type),category:['cargo','tanker','passenger','fishing','other'].includes(raw.category)?raw.category:shipCategory(type),
  messageType:clean(raw.messageType,50),positionLatency:raw.positionLatency===true,destination:clean(raw.destination??raw.DESTINATION),eta:clean(raw.eta??raw.ETA,40),status:clean(raw.status??raw.STATUS,50),stale:now-Date.parse(asOf)>30*60000,track}
}
export function normalizeFreight(raw,now=Date.now()) {
 if(!FREIGHT_INDICES.some(x=>x.code===raw.code))throw Error('지원하지 않는 운임지수')
 const value=bounded(raw.value,0,1e9),asOf=observedDate(raw.asOf,now)
 if(value===null||!asOf)throw Error('운임지수 값·기준일 필요')
 const previousValue=bounded(raw.previousValue,0,1e9),previousAsOf=observedDate(raw.previousAsOf,now)
 if(previousValue!==null&&(!previousAsOf||previousAsOf>=asOf))throw Error('직전 발표 기준일 오류')
 if(!['daily','weekly'].includes(raw.frequency))throw Error('발표 주기 필요')
 const sourceName=clean(raw.source?.name),url=String(raw.source?.url||'')
 let sourceUrl;try{sourceUrl=new URL(url);if(sourceUrl.protocol!=='https:'||sourceUrl.username||sourceUrl.password)throw Error()}catch{throw Error('HTTPS 출처 필요')}
 if(!sourceName)throw Error('출처명 필요')
 return {code:raw.code,value,asOf,previousValue,previousAsOf:previousValue!==null?previousAsOf:null,frequency:raw.frequency,source:{name:sourceName,url:sourceUrl.href}}
}
export function freightRows(saved=[],now=Date.now()) {
 return FREIGHT_INDICES.map(meta=>{
  const row=saved.find(x=>x.code===meta.code)
  if(!row)return {...meta,value:null,asOf:null,previousValue:null,previousAsOf:null,change:null,pctChange:null,status:'key_required'}
  const valid=normalizeFreight(row,now),change=valid.previousValue===null?null:valid.value-valid.previousValue
  return {...meta,...valid,change,pctChange:valid.previousValue>0?change/valid.previousValue*100:null,status:now-Date.parse(valid.asOf)>(valid.frequency==='weekly'?10:4)*86400000?'stale':'observed'}
 })
}
export function filterVessels(vessels,{q='',category='all',bounds=null}={}) {
 const text=String(q).toLowerCase().slice(0,100)
 return vessels.filter(v=>(!text||[v.name,v.mmsi,v.imo].some(s=>s.toLowerCase().includes(text)))&&(category==='all'||v.category===category)&&(!bounds||((v.lat>=bounds.south&&v.lat<=bounds.north)&&(bounds.west<=bounds.east?(v.lon>=bounds.west&&v.lon<=bounds.east):(v.lon>=bounds.west||v.lon<=bounds.east)))))
}

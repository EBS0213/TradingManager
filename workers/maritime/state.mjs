import {normalizeVessel} from './data.mjs';
const POSITION_TYPES=new Set(['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport','LongRangeAisBroadcastMessage']);
export class VesselState {
 constructor({now=Date.now,limit=250000}={}){this.now=now;this.limit=limit;this.ships=new Map();this.static=new Map();this.dirty=new Set()}
 accept(envelope){
  const type=envelope?.MessageType,meta=envelope?.MetaData,data=envelope?.Message?.[type];
  if(!meta||!data||data.Valid===false)return false;
  const mmsi=String(meta.MMSI??data.UserID??'');if(!/^\d{9}$/.test(mmsi))return false;
  const now=this.now();
  if(type==='ShipStaticData'||type==='StaticDataReport'){
   const fields={...(this.static.get(mmsi)||{})};
   if(type==='ShipStaticData'){
    if(data.Name?.trim())fields.name=data.Name;
    if(data.Type>0)fields.type=data.Type;
    if(data.ImoNumber)fields.imo=String(data.ImoNumber);
    if(data.Destination?.trim())fields.destination=data.Destination;
   }else{
    if(data.ReportA?.Valid&&data.ReportA.Name?.trim())fields.name=data.ReportA.Name;
    if(data.ReportB?.Valid&&data.ReportB.ShipType>0)fields.type=data.ReportB.ShipType;
   }
   this.static.delete(mmsi);this.static.set(mmsi,{...fields,at:now});
   while(this.static.size>500000)this.static.delete(this.static.keys().next().value);
   const old=this.ships.get(mmsi);if(old){const next=normalizeVessel({...old,...fields,category:undefined},now);if(next){this.ships.set(mmsi,next);this.dirty.add(mmsi)}}
   return false; // Static data must never refresh a position timestamp.
  }
  if(!POSITION_TYPES.has(type))return false;
  const old=this.ships.get(mmsi),details=this.static.get(mmsi)||{};
  const rawTime=meta.time_utc;
  // Stream arrival time is used only when the provider omits its event timestamp.
  const parsed=rawTime?Date.parse(String(rawTime).replace(/ ([+-]\d{4}) UTC$/, '$1').replace(/ UTC$/, 'Z').replace(' ','T').replace(/(\.\d{3})\d+/, '$1')):now;
  if(!Number.isFinite(parsed))return false;
  const asOf=new Date(parsed).toISOString();
  if(old&&asOf<=old.asOf)return false;
  const row=normalizeVessel({mmsi,name:details.name||meta.ShipName||old?.name,type:details.type??old?.type,imo:details.imo||old?.imo,destination:details.destination||old?.destination,
   lat:data.Latitude??meta.latitude??meta.Latitude,lon:data.Longitude??meta.longitude??meta.Longitude,asOf,
   speed:type==='LongRangeAisBroadcastMessage'&&data.Sog===63?null:data.Sog,course:data.Cog,heading:data.TrueHeading,messageType:type,positionLatency:!!data.PositionLatency,track:old?.track||[]},now);
  if(!row)return false;
  const last=row.track.at(-1);
  if(!last||Date.parse(row.asOf)-Date.parse(last.asOf)>=60000){
   let history=row.track.filter(p=>Date.parse(p.asOf)>=now-7*86400000);
   if(history.length>=200)history=[...history.slice(0,100).filter((_,i)=>i%2===0),...history.slice(100)];
   row.track=[...history,{lat:row.lat,lon:row.lon,asOf:row.asOf}];
  }
  this.ships.delete(mmsi);this.ships.set(mmsi,row);this.dirty.add(mmsi);
  while(this.ships.size>this.limit){const id=this.ships.keys().next().value;this.ships.delete(id);this.dirty.delete(id)};
  return true;
 }
 checkpoint(){return {items:[...this.ships.values()],static:[...this.static.entries()]}}
 batches(){
  const batches=[];let items=[],bytes=150;
  for(const id of this.dirty){const row=this.ships.get(id);if(!row)continue;const size=Buffer.byteLength(JSON.stringify(row))+1;if(items.length>=1000||bytes+size>1800000){batches.push({kind:'vessels',mode:'upsert',source:{name:'AISstream',url:'https://aisstream.io/'},items});items=[];bytes=150}items.push(row);bytes+=size}
  if(items.length)batches.push({kind:'vessels',mode:'upsert',source:{name:'AISstream',url:'https://aisstream.io/'},items});return batches;
 }
 ack(items){for(const row of items)if(this.ships.get(row.mmsi)===row)this.dirty.delete(row.mmsi)}
 snapshot(){
  const cutoff=this.now()-7*86400000;
  for(const [id,row] of this.ships)if(Date.parse(row.asOf)<cutoff){this.ships.delete(id);this.dirty.delete(id)};
  for(const [id,row] of this.static)if(row.at<this.now()-30*86400000)this.static.delete(id);
  const items=[...this.ships.values()].sort((a,b)=>b.asOf.localeCompare(a.asOf));
  const body={kind:'vessels',source:{name:'AISstream',url:'https://aisstream.io/'},items:[]};let bytes=150;
  for(const item of items){const size=Buffer.byteLength(JSON.stringify(item))+1;if(bytes+size>1800000)break;body.items.push(item);bytes+=size}
  return body;
 }
 restore(items){for(const raw of items||[]){const row=normalizeVessel(raw,this.now());if(row){this.ships.set(row.mmsi,row);this.dirty.add(row.mmsi)}}this.snapshot();while(this.ships.size>this.limit){const id=this.ships.keys().next().value;this.ships.delete(id);this.dirty.delete(id)}}
}
export function subscription(key,bounds){
 const boxes=bounds?JSON.parse(bounds):[[[-85,-180],[85,180]]];
 if(!Array.isArray(boxes)||!boxes.length||boxes.some(b=>!Array.isArray(b)||b.length!==2||b.some(p=>!Array.isArray(p)||p.length!==2||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>90||Math.abs(p[1])>180)))throw Error('AIS bounding boxes invalid');
 return {APIKey:key,BoundingBoxes:boxes,FilterMessageTypes:[...POSITION_TYPES,'ShipStaticData','StaticDataReport']};
}
export async function publish(body,{base,key,fetcher=fetch}){
 if(!body.items.length)return false;
 const response=await fetcher(new URL('/api/terminal/maritime',base),{method:'POST',headers:{'Content-Type':'application/json','x-screener-key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('snapshot_http_'+response.status);
 const result=await response.json();if(result.ok!==true)throw Error('snapshot_not_accepted');return true;
}

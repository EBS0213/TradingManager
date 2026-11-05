import test from 'node:test';import assert from 'node:assert/strict';
import {VesselState,subscription,publish} from './state.mjs';
const NOW=Date.parse('2026-10-26T10:00:00Z');
function position(overrides={},time=NOW){return {MessageType:'PositionReport',MetaData:{MMSI:123456789,ShipName:'Example',time_utc:new Date(time).toISOString()},Message:{PositionReport:{Valid:true,Latitude:35,Longitude:129,Sog:12.4,Cog:86.7,TrueHeading:511,...overrides}}}}
test('position conversion, static enrichment does not refresh location time, out-of-order rejected',()=>{
 let now=NOW;const s=new VesselState({now:()=>now});assert.equal(s.accept(position()),true);
 now+=120000;s.accept({MessageType:'ShipStaticData',MetaData:{MMSI:123456789},Message:{ShipStaticData:{Valid:true,Name:'Cargo',Type:70,ImoNumber:1234567,Destination:'BUSAN'}}});
 let row=s.snapshot().items[0];assert.equal(row.asOf,new Date(NOW).toISOString());assert.equal(row.category,'cargo');assert.equal(row.heading,null);assert.equal(row.speed,12.4);
 assert.equal(s.accept(position({},NOW-1000)),false);assert.equal(s.accept(position({Latitude:36},now)),true);row=s.snapshot().items[0];assert.equal(row.track.length,2);assert.equal(row.name,'Cargo');
});
test('invalid coordinates and AIS sentinels, no fabricated vessel for static messages',()=>{
 const s=new VesselState({now:()=>NOW});assert.equal(s.accept(position({Latitude:91})),false);assert.equal(s.accept(position({Valid:false})),false);assert.equal(s.accept(position({Sog:102.3})),true);assert.equal(s.snapshot().items[0].speed,null);
});
test('expired snapshots removed, checkpoint restoration preserves timestamps and stale state',()=>{
 let now=NOW;const s=new VesselState({now:()=>now});s.accept(position());const items=s.snapshot().items;now+=3600000;const recovered=new VesselState({now:()=>now});recovered.restore(items);assert.equal(recovered.snapshot().items[0].stale,true);now+=7*86400000;assert.equal(recovered.snapshot().items.length,0);
});
test('subscription selects typed reports; credentials sent only to backend; publish retries retain snapshot',async()=>{
 assert.equal(subscription('secret').APIKey,'secret');assert.throws(()=>subscription('secret','[[[91,0],[0,0]]]'));
 const s=new VesselState({now:()=>NOW});s.accept(position());let calls=0;
 const fetcher=async(url,opts)=>{calls++;assert.equal(url.protocol,'https:');assert.equal(opts.headers['x-screener-key'],'server-key');assert.equal(JSON.parse(opts.body).items[0].mmsi,'123456789');return {ok:calls>1,status:503,json:async()=>({ok:true})}};
 await assert.rejects(publish(s.snapshot(),{base:'https://example.com',key:'server-key',fetcher}),/503/);assert.equal(s.snapshot().items.length,1);assert.equal(await publish(s.snapshot(),{base:'https://example.com',key:'server-key',fetcher}),true);assert.equal(await publish({items:[]},{fetcher:()=>{throw Error('must not upload empty')}}),false);
});
test('snapshot payload obeys server body limit and newest-observation priority',()=>{
 const s=new VesselState({now:()=>NOW});for(let i=0;i<5000;i++){const p=position();p.MetaData.MMSI=100000000+i;p.MetaData.ShipName='x'.repeat(120);s.accept(p)}assert.ok(Buffer.byteLength(JSON.stringify(s.snapshot()))<1800100);assert.ok(s.snapshot().items.length>0);
});
test('KEY SECURE keychain is preferred; missing keychain falls back without exposing secrets',async()=>{
 const {aisKey}=await import('./credentials.mjs');
 assert.equal(aisKey({env:{AISSTREAM_API_KEY:'fallback'},read:(cmd,args)=>{assert.equal(cmd,'/usr/bin/security');assert.ok(args.includes('tm26-aisstream'));return 'test-key\n'}}),'test-key');
 assert.equal(aisKey({env:{AISSTREAM_API_KEY:'fallback'},read:()=>{throw Error('locked')}}),'fallback');
 assert.equal(aisKey({env:{},read:()=>{throw Error('missing')}}),'');
});
test('actual AISstream Go timestamp with nanoseconds and UTC offset is parsed',()=>{const s=new VesselState({now:()=>NOW});const p=position();p.MetaData.time_utc='2026-10-26 10:00:00.000515679 +0000 UTC';assert.equal(s.accept(p),true);assert.equal(s.snapshot().items[0].asOf,'2026-10-26T10:00:00.000Z')});
test('more than 5000 ships survive checkpoints and bounded batches; in-flight updates are not acknowledged away',()=>{
 const s=new VesselState({now:()=>NOW+60000});for(let i=0;i<6500;i++){const p=position();p.MetaData.MMSI=100000000+i;s.accept(p)}
 const batches=s.batches();assert.equal(s.checkpoint().items.length,6500);assert.equal(batches.reduce((n,b)=>n+b.items.length,0),6500);assert.ok(batches.every(b=>b.items.length<=1000&&Buffer.byteLength(JSON.stringify(b))<2000000));
 const old=batches[0].items[0];const p=position({},NOW+60000);p.MetaData.MMSI=Number(old.mmsi);s.accept(p);for(const b of batches)s.ack(b.items);assert.equal(s.dirty.size,1);assert.equal(s.batches()[0].items[0].asOf,new Date(NOW+60000).toISOString());
 const restored=new VesselState({now:()=>NOW+60000});restored.restore(s.checkpoint().items);assert.equal(restored.ships.size,6500);
});

test('Class B static parts merge without erasing identity or advancing position time',()=>{
 const s=new VesselState({now:()=>NOW});s.accept(position());
 s.accept({MessageType:'StaticDataReport',MetaData:{MMSI:123456789},Message:{StaticDataReport:{Valid:true,ReportA:{Valid:true,Name:'CLASS B SHIP'},ReportB:{Valid:false}}}});
 s.accept({MessageType:'StaticDataReport',MetaData:{MMSI:123456789},Message:{StaticDataReport:{Valid:true,ReportA:{Valid:false,Name:''},ReportB:{Valid:true,ShipType:70}}}});
 const v=s.ships.get('123456789');assert.equal(v.name,'CLASS B SHIP');assert.equal(v.category,'cargo');assert.equal(v.asOf,new Date(NOW).toISOString());
 assert.ok(subscription('test').FilterMessageTypes.includes('StaticDataReport'));
});
test('long range position reports use their own unavailable speed sentinel and preserve latency',()=>{
 const s=new VesselState({now:()=>NOW});const p=position();p.MessageType='LongRangeAisBroadcastMessage';p.Message={LongRangeAisBroadcastMessage:{...p.Message.PositionReport,Sog:63,Cog:511,PositionLatency:true}};
 assert.equal(s.accept(p),true);const v=s.ships.get('123456789');assert.equal(v.speed,null);assert.equal(v.course,null);assert.equal(v.positionLatency,true);assert.equal(v.messageType,'LongRangeAisBroadcastMessage');assert.ok(subscription('test').FilterMessageTypes.includes(p.MessageType));
});
test('voyage history retains old observations while bounding size rather than discarding everything beyond twelve points',()=>{
 let now=NOW;const s=new VesselState({now:()=>now});for(let i=0;i<450;i++){now=NOW+i*60000;s.accept(position({Longitude:100+i/1000},now))}
 const v=s.ships.get('123456789');assert.ok(v.track.length>12&&v.track.length<=200);assert.equal(v.track[0].asOf,new Date(NOW).toISOString());assert.equal(v.track.at(-1).asOf,new Date(now).toISOString());
});

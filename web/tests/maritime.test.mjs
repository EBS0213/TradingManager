import {test} from 'node:test';import assert from 'node:assert/strict';
import {normalizeVessel,normalizeFreight,freightRows,filterVessels} from '../lib/maritime/data.mjs';
const now=Date.parse('2026-10-26T10:00:00Z');
const vessel={MMSI:'123456789',SHIPNAME:'TEST FIXTURE',LAT:35,LON:129,TIMESTAMP:'2026-10-26T09:55:00Z',SPEED:123,SHIPTYPE:80,HEADING:511};
test('AIS units, missing sentinels, stale observations and normalized round trips',()=>{
 const v=normalizeVessel(vessel,now);assert.equal(v.speed,12.3);assert.equal(v.heading,null);assert.equal(v.category,'tanker');assert.equal(v.stale,false);
 assert.deepEqual(normalizeVessel(v,now),v);assert.equal(normalizeVessel({...vessel,SPEED:1023},now).speed,null);
 assert.equal(normalizeVessel({...vessel,TIMESTAMP:'2026-10-26T08:00:00Z'},now).stale,true);
});
test('invalid locations, identifier, future and absent dates are rejected',()=>{
 for(const change of [{LAT:91},{LAT:null},{LON:181},{MMSI:'123'},{TIMESTAMP:null},{TIMESTAMP:'2030-01-01'}])assert.equal(normalizeVessel({...vessel,...change},now),null);
});
test('filter finds names/identifiers and handles dateline-crossing map bounds',()=>{
 const list=[normalizeVessel(vessel,now),normalizeVessel({...vessel,MMSI:'223456789',SHIPTYPE:70,LON:-179},now)];
 assert.equal(filterVessels(list,{q:'test',category:'tanker'}).length,1);
 assert.equal(filterVessels(list,{bounds:{south:0,north:80,west:170,east:-170}})[0].mmsi,'223456789');
});
const freight={code:'BDI',value:1100,asOf:'2026-10-23',previousValue:1000,previousAsOf:'2026-10-22',frequency:'daily',source:{name:'TEST ONLY',url:'https://example.com/'}};
test('freight percentage derives from the actual previous publication; missing is not zero',()=>{
 const row=freightRows([freight],now)[0];assert.equal(row.change,100);assert.equal(row.pctChange,10);assert.equal(row.status,'observed');
 const missing=freightRows([],now)[0];assert.equal(missing.value,null);assert.equal(missing.pctChange,null);
 assert.equal(freightRows([{...freight,previousValue:null,previousAsOf:null}],now)[0].pctChange,null);
 assert.equal(freightRows([{...freight,previousValue:0}],now)[0].pctChange,null);
});
test('freight rejects invented comparison dates, unknown index and unsafe sources',()=>{
 for(const change of [{previousAsOf:'2026-10-24'},{previousAsOf:null},{code:'OTHER'},{value:null},{source:{name:'x',url:'javascript:alert(1)'}},{frequency:'realtime'}])assert.throws(()=>normalizeFreight({...freight,...change},now));
});

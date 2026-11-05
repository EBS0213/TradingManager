import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeObservations,POSITION_TTL} from '../lib/aviation/observations.mjs';
const now=Date.now();
const plane=(id,time=now,lon=129)=>({id,asOf:new Date(time).toISOString(),lat:35.5,lon,stale:false});
test('missing aircraft survive successful, empty and failed snapshots with unchanged observation time',()=>{
 const a=plane('abc120'),b=plane('abc121');
 let result=mergeObservations([a,b],[b],now+10000);
 assert.equal(result.length,2);assert.equal(result[0].stale,true);assert.equal(result[0].asOf,a.asOf);
 result=mergeObservations(result,[],now+20000);assert.equal(result.length,2);assert.ok(result.every(a=>a.stale));
 assert.deepEqual(mergeObservations(result,[],now+POSITION_TTL),[]);
});
test('new observations restore marker; old cached snapshots cannot move it backwards or prolong its life',()=>{
 const old=plane('abc120',now-30000,128),fresh=plane('abc120',now,129);
 let result=mergeObservations([{...old,stale:true}],[fresh],now);assert.equal(result[0].lon,129);assert.equal(result[0].stale,false);
 result=mergeObservations(result,[old],now+10000);assert.equal(result[0].lon,129);assert.equal(result[0].asOf,fresh.asOf);
 assert.deepEqual(mergeObservations([], [plane('abc120',now-POSITION_TTL),{...fresh,asOf:'bad'}],now),[]);
});

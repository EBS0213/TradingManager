import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeTrackPoints,trackSegments,TRACK_WINDOW} from '../lib/aviation/tracks.mjs';
const now=Date.now();
const point=(age,lon=129)=>({lat:35,lon,asOf:new Date(now-age).toISOString()});
test('saved history appears immediately with current observation, without duplicate or invented points',()=>{
 const old=point(120000,128.8),recent=point(60000,128.9),current=point(0);
 const points=mergeTrackPoints([[recent,old],[recent,current]],now);
 assert.deepEqual(points,[old,recent,current]);
 assert.equal(trackSegments(points).length,1);
 assert.equal(mergeTrackPoints([[point(TRACK_WINDOW+1),{...current,asOf:'bad'},{...current,lon:181}]],now).length,0);
});
test('missing reception, discontinuous positions and date line never become a false route',()=>{
 assert.deepEqual(trackSegments([point(900000),point(0)]),[]);
 assert.deepEqual(trackSegments([point(60000,100),point(0,129)]),[]);
 assert.deepEqual(trackSegments([point(60000,179.99),point(0,-179.99)]),[]);
 assert.deepEqual(trackSegments([point(0)]),[]);
});

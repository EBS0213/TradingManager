import test from 'node:test'
import assert from 'node:assert/strict'
import {createDataRefreshLoop} from '../lib/terminal/data-refresh-loop.mjs'
test('automatic startup collection persists completion and schedules the next run without UI requests',async()=>{
 const timers=[],saved=[];let calls=0,time=1800000000000
 const loop=createDataRefreshLoop({collect:async()=>{calls++;return {prices:{status:'available',count:40}}},saveStatus:async value=>saved.push(structuredClone(value)),now:()=>time,setTimer:(fn,delay)=>{timers.push({fn,delay});return {unref(){}}}})
 loop.start();loop.start();assert.equal(timers.length,1);assert.equal(timers[0].delay,5000)
 await loop.tick();assert.equal(calls,1);assert.equal(saved.at(-1).phase,'idle');assert.equal(Date.parse(saved.at(-1).nextRunAt)-time,15*60000)
 time+=15*60000;await loop.tick();assert.equal(calls,2);assert.equal(saved.at(-1).results.prices.count,40)
})
test('overlapping timer ticks share the running collection and errors schedule a retry',async()=>{
 let release,calls=0;const delays=[]
 const loop=createDataRefreshLoop({collect:()=>{calls++;return new Promise(resolve=>release=resolve)},setTimer:(fn,delay)=>{delays.push(delay);return {unref(){}}}})
 const first=loop.tick();await new Promise(resolve=>setImmediate(resolve));await loop.tick();assert.equal(calls,1);release({});await first
 const failed=createDataRefreshLoop({collect:async()=>{throw new Error('offline')},setTimer:(fn,delay)=>{delays.push(delay);return {unref(){}}}})
 await failed.tick();assert.equal(failed.getStatus().phase,'error');assert.equal(delays.at(-1),15*60000)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {fetchAviation,aviationRefetchInterval} from '../lib/aviation/refresh.mjs'
test('polling reaches the collector even when a browser has an old response cached',async()=>{
 const controller=new AbortController()
 const data=await fetchAviation('/api/terminal/aviation?lat=36&lon=129',controller.signal,async(url,options)=>{
  assert.equal(options.cache,'no-store');assert.equal(options.signal,controller.signal)
  return {ok:true,json:async()=>({ok:true,aircraft:[]})}
 });assert.equal(data.ok,true)
 await assert.rejects(fetchAviation('/',null,async()=>({ok:false,status:503})),/503/)
})
test('stale snapshots request fresh collection promptly instead of waiting for the normal interval',()=>{
 const now=Date.now()
 assert.equal(aviationRefetchInterval({status:'observed',updatedAt:new Date(now).toISOString()},now),30000)
 for(const data of [undefined,{status:'pending'},{status:'stale'},{status:'unavailable'},{status:'observed',updatedAt:new Date(now-120000).toISOString()}])
  assert.equal(aviationRefetchInterval(data,now),10000)
})

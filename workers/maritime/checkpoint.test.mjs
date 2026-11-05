import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {VesselState} from './state.mjs'
import {saveState,restoreState} from './checkpoint.mjs'
test('streaming checkpoint preserves vessel tracks, static fields and dirty replay',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tm26-checkpoint-'))
 try{
  const state=new VesselState(),stamp=new Date().toISOString()
  for(let i=0;i<6000;i++){const mmsi=String(200000000+i);state.ships.set(mmsi,{mmsi,lat:37,lon:127,asOf:stamp,track:[{lat:37,lon:127,asOf:stamp}]});state.static.set(mmsi,{name:'Test',at:Date.now()})}
  const file=join(dir,'state.ndjson');await saveState(file,state)
  const restored=new VesselState();await restoreState(file,restored)
  assert.deepEqual(restored.ships,state.ships);assert.deepEqual(restored.static,state.static);assert.equal(restored.dirty.size,6000)
 }finally{await rm(dir,{recursive:true,force:true})}
})

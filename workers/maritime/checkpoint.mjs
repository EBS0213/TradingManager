import {createReadStream,createWriteStream} from 'node:fs'
import {rename} from 'node:fs/promises'
import {createInterface} from 'node:readline'
import {pipeline} from 'node:stream/promises'
// Stream each vessel separately, avoiding V8's 512 MB string ceiling.
export async function saveState(file,state){
 const ships=[...state.ships.values()],statics=[...state.static.entries()]
 async function* rows(){
  for(const row of ships)yield JSON.stringify({kind:'ship',row})+'\n'
  for(const row of statics)yield JSON.stringify({kind:'static',row})+'\n'
 }
 await pipeline(rows(),createWriteStream(file+'.tmp',{mode:0o600}))
 await rename(file+'.tmp',file)
}
export async function restoreState(file,state){
 const lines=createInterface({input:createReadStream(file),crlfDelay:Infinity})
 for await(const line of lines){
  const {kind,row}=JSON.parse(line)
  if(kind==='ship'){state.ships.set(row.mmsi,row);state.dirty.add(row.mmsi)}
  else if(kind==='static')state.static.set(...row)
 }
 state.snapshot()
}

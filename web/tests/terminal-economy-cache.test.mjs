import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

// Load the cache without the Next.js alias or a real database connection.
const source=(await readFile(new URL('../lib/terminal/economy-cache.js',import.meta.url),'utf8'))
  .replace("import {getSql} from '@/lib/db'",'const getSql=()=>{throw new Error("Unexpected real database call")}')
const {createEconomyCache}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const result=value=>({series:[{id:'test',value,status:'available',note:'original'}],fetchedAt:'2026-10-21'})
const dbKey='terminal_economy_v1_bls',leaseKey=`${dbKey}:refresh_lease`

function database(clock) {
  const records=new Map(),queries=[]
  const sql=async(strings,...values)=>{
    const text=strings.join('?');queries.push(text)
    if(text.includes('SELECT value'))return records.has(values[0])?[records.get(values[0])]:[]
    if(text.includes('RETURNING key')){
      assert.match(text,/ON CONFLICT\(key\) DO UPDATE SET updated_at=now\(\)/)
      assert.match(text,/WHERE screener_settings\.updated_at <= now\(\)-\(\? \* INTERVAL '1 second'\)/)
      const old=records.get(values[0])
      if(old && clock()-new Date(old.updated_at).getTime()<values[1]*1000)return []
      records.set(values[0],{value:{kind:'economy-refresh-lease'},updated_at:new Date(clock())})
      return [{key:values[0]}]
    }
    records.set(values[0],{value:JSON.parse(values[1]),updated_at:new Date(clock())})
    return []
  }
  return {records,queries,sql}
}
const realWait=ms=>new Promise(resolve=>setTimeout(resolve,ms))

test('two cold server instances and same-instance callers share one source refresh',async()=>{
  const db=database(Date.now)
  const options={getDatabase:async()=>db.sql,databaseConfigured:()=>true,wait:()=>realWait(2)}
  const a=createEconomyCache(options),b=createEconomyCache(options)
  let calls=0
  const loader=async()=>{calls++;await realWait(15);return result(0)}
  const values=await Promise.all([a('bls',43200000,loader),a('bls',43200000,loader),b('bls',43200000,loader)])
  assert.equal(calls,1)
  assert.ok(values.every(value=>value.series[0].value===0))
  assert.ok(db.records.has(leaseKey))
  assert.ok(db.records.has(dbKey))
})

test('a lease contender immediately returns a truthful stale observation without polling',async()=>{
  const clock=()=>1800000000000,db=database(clock)
  db.records.set(dbKey,{value:result(4),updated_at:new Date(clock()-120000)})
  db.records.set(leaseKey,{value:{},updated_at:new Date(clock())})
  const cache=createEconomyCache({getDatabase:async()=>db.sql,databaseConfigured:()=>true,now:clock,wait:()=>assert.fail('Must not wait with prior data')})
  const value=await cache('bls',60000,()=>assert.fail('Contender must not call source'))
  assert.equal(value.series[0].value,4)
  assert.equal(value.series[0].status,'stale')
  assert.equal(value.stale,true)
  assert.match(value.series[0].note,/갱신 중/)
  assert.equal(db.queries.filter(query=>query.includes('SELECT')).length,1)
})

test('a cold contender stops after ten seconds without fetching the source',async()=>{
  let time=1800000000000;const start=time,db=database(()=>time)
  db.records.set(leaseKey,{value:{},updated_at:new Date(time)})
  const cache=createEconomyCache({getDatabase:async()=>db.sql,databaseConfigured:()=>true,now:()=>time,wait:async ms=>{time+=ms}})
  await assert.rejects(cache('bls',43200000,()=>assert.fail('Contender must not call source')),/잠시 후 다시 시도/)
  assert.equal(time-start,10000)
})

test('an expired lease can be reused without deleting the lease record',async()=>{
  const clock=()=>1800000000000,db=database(clock)
  db.records.set(leaseKey,{value:{},updated_at:new Date(clock()-3600000)})
  const cache=createEconomyCache({getDatabase:async()=>db.sql,databaseConfigured:()=>true,now:clock})
  assert.equal((await cache('bls',43200000,async()=>result(7))).series[0].value,7)
  assert.equal(new Date(db.records.get(leaseKey).updated_at).getTime(),clock())
  assert.ok(db.queries.every(query=>!query.includes('DELETE')))
})

test('an ambiguous lease error does not bypass the shared lock',async()=>{
  let time=1800000000000
  const sql=async strings=>{
    if(strings.join('').includes('RETURNING key'))throw new Error('Connection lost after commit')
    return []
  }
  const cache=createEconomyCache({getDatabase:async()=>sql,databaseConfigured:()=>true,now:()=>time,wait:async ms=>{time+=ms}})
  await assert.rejects(cache('bls',43200000,()=>assert.fail('Uncertain owner must not fetch')),/갱신 상태/)
})

test('local mode and unavailable persistence retain singleflight and usable observations',async()=>{
  for(const databaseConfigured of [()=>false,()=>true]){
    const cache=createEconomyCache({databaseConfigured,getDatabase:async()=>{throw new Error('Offline')}})
    let calls=0
    const loader=async()=>{calls++;await realWait(2);return result(9)}
    const values=await Promise.all([cache('bls',43200000,loader),cache('bls',43200000,loader)])
    assert.equal(calls,1)
    assert.ok(values.every(value=>value.series[0].value===9))
    assert.equal((await cache('bls',43200000,loader)).cached,true)
    assert.equal(calls,1)
  }
})

test('BLS failures and empty observations are held for one hour locally',async()=>{
  for(const empty of [false,true]){
    let time=1800000000000,calls=0
    const cache=createEconomyCache({databaseConfigured:()=>false,now:()=>time})
    const loader=async()=>{calls++;if(empty)return {series:[{value:null,status:'unavailable'}]};throw new Error('Source outage')}
    const request=()=>cache('bls',43200000,loader)
    if(empty)await request();else await assert.rejects(request(),/조회에 실패/)
    time+=3599999
    if(empty)assert.equal((await request()).series[0].value,null);else await assert.rejects(request(),/조회에 실패/)
    assert.equal(calls,1)
    time++
    if(empty)await request();else await assert.rejects(request(),/조회에 실패/)
    assert.equal(calls,2)
  }
})

test('BLS uses a one-hour shared lease while other sources retain sixty seconds',async()=>{
  const clock=()=>1800000000000,leaseSeconds=[]
  const sql=async(strings,...values)=>{
    if(strings.join('').includes('RETURNING key')){leaseSeconds.push(values[1]);return [{key:values[0]}]}
    return []
  }
  const cache=createEconomyCache({getDatabase:async()=>sql,databaseConfigured:()=>true,now:clock})
  await cache('bls',43200000,async()=>result(1))
  await cache('overview',900000,async()=>result(1))
  assert.deepEqual(leaseSeconds,[3600,60])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {numeric,marketItem,marketSnapshot,observedHistory,localOverview,INDICES} from '../lib/terminal/data.mjs'
test('missing observations stay unavailable, never zero or random',()=>{
  assert.equal(numeric(null),null)
  const row=marketItem(INDICES[0],null)
  assert.equal(row.value,null);assert.equal(row.avat,null);assert.equal(row.ytd,null)
  assert.deepEqual(row.sparkline1,[]);assert.equal(row.dataStatus,'unavailable')
  const out=marketSnapshot(INDICES.map(spec=>marketItem(spec,null)))
  assert.equal(out.status,'unavailable');assert.equal(out.coverage.available,0)
  assert.match(localOverview('overview',out),/시세가 없습니다/)
})
test('Naver down direction is respected, unavailable secondary metrics preserved',()=>{
  const row=marketItem(INDICES[0],{closePrice:'45,000.12',compareToPreviousClosePrice:'120',fluctuationsRatio:'0.27',compareToPreviousPrice:{code:'5'}})
  assert.equal(row.value,45000.12);assert.equal(row.change,-120);assert.equal(row.pctChange,-.27)
  assert.equal(row.ytd,null)
})
test('history dates originate in observations, unknown dates are discarded',()=>{
  const rows=observedHistory([{localDateTime:'20261021151000',currentPrice:100},{time:'invalid',value:80},{value:70}])
  assert.equal(rows.length,1);assert.equal(rows[0].time,'2026-10-21T15:10:00+09:00')
})
test('stale source cannot become delayed by normalizing it',()=>{
  const items=INDICES.map((spec,i)=>marketItem(spec,i===0?{price:1,rate:-1}:null,{status:'stale',asOf:'2026-10-20T00:00:00Z'}))
  const out=marketSnapshot(items)
  assert.equal(out.status,'stale');assert.match(localOverview('DOW JONES',out),/-1.00%/)
})

test('daily observations retain trading dates and OHLC without synthesizing a time',async()=>{
  const {observedDailyHistory}=await import('../lib/terminal/data.mjs')
  const points=observedDailyHistory([
    {localDate:'20261020',closePrice:'1,000',openPrice:990,highPrice:1010,lowPrice:980,accumulatedTradingVolume:50},
    {localDate:'20261021',closePrice:1005},
    {localDate:'20260230',closePrice:1},
    {localDate:'20261022',closePrice:null},
  ],{time:'2026-10-21T14:00:00+09:00',marketStatus:'OPEN'})
  assert.equal(points.length,2)
  assert.equal(points[0].time,'2026-10-20');assert.equal(points[0].value,1000)
  assert.equal(points[0].high,1010);assert.equal(points[0].isComplete,true)
  assert.equal(points[1].isComplete,false);assert.equal(points[1].high,null)
})

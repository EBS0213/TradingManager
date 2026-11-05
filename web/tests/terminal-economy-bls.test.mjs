import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeBls} from '../lib/terminal/economy-bls.mjs'
const now=new Date('2026-10-21T00:00:00Z')
const body=rows=>({status:'REQUEST_SUCCEEDED',Results:{series:rows}})
const point=(year,period,value)=>({year,period,value})
test('BLS missing observations never turn into zero; annual averages and future months are excluded',()=>{
  const result=normalizeBls(body([{seriesID:'LNS14000000',data:[point('2026','M09','0'),point('2026','M08',null),point('2026','M13','4'),point('2027','M01','6')]}]),now)
  assert.deepEqual(result.series[0].points,[{date:'2026-09',value:0}]);assert.equal(result.series[0].previous,null)
  assert.equal(normalizeBls({status:'REQUEST_FAILED'},now).series[0].value,null)
})
test('CPI annual change uses the same month one year earlier and payroll requires adjacent months',()=>{
  const result=normalizeBls(body([
    {seriesID:'CUUR0000SA0',data:[point('2025','M09','100'),point('2026','M09','103'),point('2026','M08','102')]},
    {seriesID:'CES0000000001',data:[point('2026','M06','100'),point('2026','M08','120'),point('2026','M09','125')]},
  ]),now)
  const cpi=result.series.find(row=>row.id==='BLS_CPI_YOY');assert.equal(cpi.points.length,1);assert.ok(Math.abs(cpi.value-3)<1e-10)
  assert.deepEqual(result.series.find(row=>row.id==='BLS_PAYROLL_CHANGE').points,[{date:'2026-09',value:5}])
})

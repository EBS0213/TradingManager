import test from 'node:test'
import assert from 'node:assert/strict'
import {financialProjection,marketRows} from '../lib/terminal/equities-data.mjs'
test('SEC revenue stays in raw USD and its percentage ratio is converted once',()=>{
 const data=financialProjection({'매출당분기':94036000000,'매출전년':85777000000,'매출증가율':.096,'EPS당분기':1.57,'EPS전년':1.4,'EPS증가율':.1214,'EPS출처':'EarningsPerShareDiluted','실적분기목록':'CY2025Q2','매출분기목록':'94036000000','EPS분기목록':'1.57','매출성장목록':'.096','EPS성장목록':'.1214'},'2026-08-27')
 assert.equal(data.revenue,94036000000);assert.equal(data.quarters[0].revenue,94036000000);assert.equal(data.revenueUnit,'USD');assert.equal(data.eps,1.57);assert.equal(data.revenueGrowthPercent,9.6)
})
test('net income substituted for EPS remains explicitly unavailable as EPS',()=>{
 const data=financialProjection({'EPS출처':'순이익','EPS당분기':50000000,'EPS전년':25000000,'EPS증가율':1,'실적분기목록':'CY2025Q2','EPS분기목록':'50000000','EPS성장목록':'1'},'2026-08-27')
 assert.equal(data.eps,null);assert.equal(data.epsGrowthPercent,null);assert.equal(data.quarters[0].eps,null);assert.equal(data.quarters[0].epsGrowthPercent,null)
})
test('daily quote missing previous observation has no fabricated percent change',()=>{
 const [quote]=marketRows({day:'2026-10-21',rows:[{sym:'IBM',c:100,v:100}]},null)
 assert.equal(quote.price,100);assert.equal(quote.previousClose,null);assert.equal(quote.change,null);assert.equal(quote.changePercent,null)
})

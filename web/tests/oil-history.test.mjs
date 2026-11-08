import test from 'node:test'
import assert from 'node:assert/strict'
import {oilHistoryRequest,parseOilHistoryCsv} from '../lib/terminal/oil-history-data.mjs'
import {aggregateOilPoints} from '../components/economy/oil-history-view.mjs'
const now=Date.parse('2026-11-08T00:00:00Z')
test('official CSV requests fix USD, pad dates and select all product columns',()=>{
 const request=oilHistoryRequest('products',now),body=new URLSearchParams(request.body)
 assert.equal(body.get('SEL_DIV'),'div_dar');assert.equal(body.get('STA_Y'),'2008');assert.equal(body.get('STA_D'),'01');assert.equal(body.get('END_D'),'08')
 assert.equal(body.get('OILSRTCD7'),'F001');assert.equal(body.get('TERM'),'D')
 assert.throws(()=>oilHistoryRequest('invalid',now))
})
test('CSV preserves actual full-period dates, blank cells and the first observed value',()=>{
 const data=parseOilHistoryCsv('기간,Dubai,Brent,WTI\r\n08년01월02일,89.29,97.84,99.62\r\n26년11월05일,92.85,,90.52\r\n26년11월06일,96.30,98.32,90.83','crude',now)
 assert.equal(data.series.length,3);assert.equal(data.series[0].points[0].date,'2008-01-02')
 assert.equal(data.series[1].points[1].value,null);assert.equal(data.series[0].value,96.3)
 assert.equal(data.coverage.dates,3)
})
test('changed headers, missing columns and invalid/future dates fail closed',()=>{
 for(const csv of ['<html>login</html>','기간,Brent,Dubai,WTI\n26년11월06일,1,2,3','기간,Dubai,Brent,WTI\n26년02월30일,1,2,3','기간,Dubai,Brent,WTI\n26년11월09일,1,2,3'])assert.throws(()=>parseOilHistoryCsv(csv,'crude',now))
})
test('period means exclude missing cells but retain zero and never fill missing periods',()=>{
 const points=[{date:'2026-10-30',value:10},{date:'2026-11-02',value:null},{date:'2026-11-03',value:0},{date:'2026-11-04',value:20}]
 assert.deepEqual(aggregateOilPoints(points,'monthly'),[{date:'2026-10',value:10},{date:'2026-11',value:10}])
 assert.deepEqual(aggregateOilPoints([{date:'2026-11-02',value:null}],'weekly'),[{date:'2026-11-02',value:null}])
 assert.deepEqual(aggregateOilPoints(points,'annual'),[{date:'2026',value:10}])
})

test('negative WTI settlement prices are real observations, not missing cells',()=>{
 const data=parseOilHistoryCsv('기간,Dubai,Brent,WTI\n20년04월20일,22,25,-37.63\n20년04월21일,20,23,10.01','crude',now)
 assert.equal(data.series[2].points[0].value,-37.63)
 assert.equal(data.series[2].previous,-37.63)
})

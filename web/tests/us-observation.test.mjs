import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseYahooObservation,parseYahooBars} from '../lib/local-market.mjs'
const stamp=Date.parse('2026-11-09T16:30:00Z')/1000
const body={chart:{result:[{meta:{symbol:'AAPL',regularMarketTime:stamp,exchangeTimezoneName:'America/New_York'},timestamp:[stamp-3*86400,stamp],indicators:{quote:[{open:[100,101],high:[102,104],low:[99,100],close:[101,103],volume:[1000,500]}]}}]}}
test('unfinished observation stays out of closed daily history',()=>{
 assert.equal(parseYahooObservation(body,'AAPL').d,'20261109')
 assert.equal(parseYahooObservation(body,'AAPL').c,103)
 assert.deepEqual(parseYahooBars(body,'AAPL','2026-11-06').map(x=>x.d),['20261106'])
})
test('wrong symbol or timestamp cannot become current price',()=>{
 assert.equal(parseYahooObservation(body,'MSFT'),null)
 const missing=structuredClone(body);delete missing.chart.result[0].meta.regularMarketTime
 assert.equal(parseYahooObservation(missing,'AAPL'),null)
 const stale=structuredClone(body);stale.chart.result[0].meta.regularMarketTime-=86400
 assert.equal(parseYahooObservation(stale,'AAPL'),null)
})

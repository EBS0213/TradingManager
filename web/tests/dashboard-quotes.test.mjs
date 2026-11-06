import test from 'node:test'
import assert from 'node:assert/strict'
import {majorStockQuote,loadMajorStocks} from '../lib/terminal/major-stocks-data.mjs'
import {yahooIndex} from '../lib/terminal/index-fallback-data.mjs'

const now=Date.parse('2026-11-06T16:30:00Z')
const quote={symbolCode:'AAPL',stockEndType:'stock',currencyType:{code:'USD'},marketValue:'5,000,000',marketValueRaw:'5000000000000',
  closePriceRaw:'344.33',compareToPreviousClosePriceRaw:'0.16',fluctuationsRatioRaw:'0.05',localTradedAt:'2026-11-06T11:23:05-05:00'}
test('major stocks use raw USD market cap and same-response quote fields',()=>{
  const r=majorStockQuote(quote,now)
  assert.equal(r.marketCap,5e12);assert.equal(r.price,344.33);assert.equal(r.changePercent,.05)
  assert.equal(r.asOf,quote.localTradedAt);assert.equal(r.status,'delayed')
  assert.ok(Math.abs(r.previousClose-344.17)<1e-9)
})
test('unsigned falling quotes retain their negative direction and a flat quote stays zero',()=>{
  const r=majorStockQuote({...quote,compareToPreviousPrice:{code:'5'}},now)
  assert.equal(r.change,-.16);assert.equal(r.changePercent,-.05)
  assert.equal(majorStockQuote({...quote,fluctuationsRatioRaw:'0'},now).changePercent,0)
})
test('missing cap is not interpreted as rank zero; ETFs and non-USD quotes cannot enter stock ranking',()=>{
  assert.equal(majorStockQuote({...quote,marketValueRaw:undefined},now),null)
  assert.equal(majorStockQuote({...quote,stockEndType:'etf'},now),null)
  assert.equal(majorStockQuote({...quote,currencyType:{code:'KRW'}},now),null)
  assert.equal(majorStockQuote({...quote,closePriceRaw:undefined},now).price,null)
  assert.equal(majorStockQuote({...quote,symbolCode:'BRK B'},now).symbol,'BRK.B')
  assert.equal(majorStockQuote({...quote,stockNameEng:'Mandatory Conv Prf Series A'},now),null)
})
test('all three exchanges contribute to combined top 30 and duplicate symbols are removed',async()=>{
  const exchanges=['NASDAQ','NYSE','AMEX'],seen=[]
  const result=await loadMajorStocks(async url=>{
    const exchange=exchanges.find(x=>url.includes('/'+x+'/'));seen.push(exchange)
    return {stocks:Array.from({length:30},(_,i)=>({...quote,symbolCode:i===0?'SHARED':exchange+i,marketValueRaw:String((exchanges.indexOf(exchange)+1)*1000-i)}))}
  },now)
  assert.equal(seen.length,3);assert.equal(result.series.length,30)
  assert.equal(new Set(result.series.map(r=>r.symbol)).size,30)
  assert.ok(result.series.every((r,i,a)=>!i||a[i-1].marketCap>=r.marketCap))
  assert.ok(result.series.some(r=>r.symbol==='AMEX1'))
})
test('an exchange outage cannot silently produce a false US top 30',async()=>{
  await assert.rejects(loadMajorStocks(async()=>({stocks:[]}),now))
})
const spec=['S&P/TSX Comp','.GSPTSE','americas']
function chart(){return {chart:{result:[{meta:{symbol:'^GSPTSE',instrumentType:'INDEX',regularMarketPrice:102,regularMarketTime:Date.parse('2026-11-06T16:00Z')/1000,
  exchangeTimezoneName:'America/Toronto',chartPreviousClose:80,currentTradingPeriod:{regular:{end:Date.parse('2026-11-06T21:00Z')/1000}}},
  timestamp:['2026-11-04T14:30Z','2026-11-05T14:30Z','2026-11-06T14:30Z'].map(t=>Date.parse(t)/1000),
  indicators:{quote:[{close:[98,100,102]}]}}]}}}
test('index fallback compares with previous trading day, never the start-of-range close',()=>{
  const r=yahooIndex(spec,chart(),now)
  assert.equal(r.value,102);assert.equal(r.change,2);assert.ok(Math.abs(r.pctChange-2)<1e-9)
  assert.equal(r.source,'Yahoo Finance');assert.equal(r.marketStatus,'OPEN');assert.equal(r.dailyHistory.at(-1).isComplete,false)
})
test('fallback validates index identity and never invents an absent daily change',()=>{
  const b=chart();b.chart.result[0].meta.symbol='^GSPC'
  assert.throws(()=>yahooIndex(spec,b,now))
  const missing=chart();missing.chart.result[0].timestamp=[]
  const r=yahooIndex(spec,missing,now)
  assert.equal(r.value,102);assert.equal(r.change,null);assert.equal(r.pctChange,null)
})
test('fallback marks old observations stale and completed bars complete',()=>{
  const r=yahooIndex(spec,chart(),now+7*86400000)
  assert.equal(r.dataStatus,'stale');assert.equal(r.dailyHistoryStatus,'stale');assert.equal(r.dailyHistory.at(-1).isComplete,true)
})

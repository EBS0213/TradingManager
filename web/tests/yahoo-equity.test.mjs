import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYahooStatistics,projectYahooStatistics,enrichUsEquity} from '../lib/terminal/yahoo-equity-data.mjs';
const r=raw=>({raw});
const data=()=>({price:{symbol:'AAPL',currency:'USD',regularMarketTime:r(1792699201)},summaryDetail:{trailingPE:r(20),dividendYield:r(.0031)},defaultKeyStatistics:{priceToBook:r(8),floatShares:r(100),trailingEps:r(3),mostRecentQuarter:r(1782518400)},financialData:{financialCurrency:'USD',totalRevenue:r(1000),profitMargins:r(-.1),returnOnEquity:r(1.4),targetMeanPrice:r(200),numberOfAnalystOpinions:r(10)}});
const html=d=>`<script type="application/json" data-sveltekit-fetched data-url="https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL">${JSON.stringify({status:200,body:JSON.stringify({quoteSummary:{result:[d],error:null}})})}</script>`;
test('public embedded JSON validates ticker and currency',()=>{
 assert.equal(parseYahooStatistics(html(data()),'AAPL').price.symbol,'AAPL');
 assert.throws(()=>parseYahooStatistics(html(data()),'MSFT'));
 const d=data();d.price.currency='EUR';assert.throws(()=>parseYahooStatistics(html(d),'AAPL'));
 assert.throws(()=>parseYahooStatistics('<script>alert(1)</script>','AAPL'));
});
test('share class aliases and raw ratios are normalized without guessing missing values',()=>{
 const d=data();d.price.symbol='BRK-B';d.summaryDetail.trailingPE={fmt:'20.00'};
 const x=projectYahooStatistics(parseYahooStatistics(html(d),'BRK.B'),'BRK.B');
 assert.equal(x.per,null);assert.equal(x.dividendYieldPercent,.31);assert.equal(x.netMarginPercent,-10);assert.equal(x.roePercent,140);assert.equal(x.financialAsOf,'2026-06-27');
});
test('quarter facts are preserved and TTM is kept separately',()=>{
 const item={symbol:'AAPL',currency:'USD',fundamentals:{revenue:25,eps:.5,quarters:[{period:'Q2'}]},profile:{sharesOutstanding:500}};
 const x=enrichUsEquity(item,projectYahooStatistics(data(),'AAPL'));
 assert.equal(x.fundamentals.revenue,25);assert.equal(x.fundamentals.eps,.5);assert.deepEqual(x.fundamentals.quarters,item.fundamentals.quarters);assert.equal(x.trailingFinancials.revenue,1000);assert.equal(x.profile.sharesOutstanding,500);assert.equal(x.profile.floatShares,100);assert.equal(x.consensus.mean,200);
});
test('empty snapshot uses explicitly labelled USD TTM',()=>{
 const x=enrichUsEquity({symbol:'AAPL',currency:'USD'},projectYahooStatistics(data(),'AAPL'));
 assert.equal(x.fundamentals.revenue,1000);assert.match(x.fundamentals.financialPeriod,/TTM/);
});
test('foreign or unknown financial currency cannot become USD earnings or price targets',()=>{
 for(const currency of ['CNY',undefined]){
 const d=data();d.financialData.financialCurrency=currency;
 const x=enrichUsEquity({symbol:'AAPL',currency:'USD'},projectYahooStatistics(d,'AAPL'));
 assert.equal(x.fundamentals.revenue,undefined);assert.equal(x.consensus,undefined);assert.equal(x.trailingFinancials.currency,currency??null);assert.equal(x.trailingFinancials.eps,null);
 }
});
test('ETF and mismatched symbols are not enriched',()=>{
 const item={symbol:'AAPL',currency:'USD',kind:'etf'};
 assert.equal(enrichUsEquity(item,projectYahooStatistics(data(),'AAPL')),item);
 const other={symbol:'MSFT',currency:'USD'};assert.equal(enrichUsEquity(other,projectYahooStatistics(data(),'AAPL')),other);
});

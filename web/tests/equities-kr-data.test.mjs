import test from 'node:test'
import assert from 'node:assert/strict'
import {koreanEquitySymbol,krNumber,koreanAmount,koreanQuote,koreanHistory,koreanDetails,koreanFundamentals} from '../lib/terminal/equities-kr-data.mjs'
const row={itemCode:'005930',stockName:'삼성전자',stockEndType:'stock',closePrice:'216,750',compareToPreviousClosePrice:'6,750',compareToPreviousPrice:{code:'5'},fluctuationsRatio:'3.02',accumulatedTradingVolume:'5,269,448',accumulatedTradingValue:'1,163,476',marketValue:'12,671,809',marketValueRaw:'1267180888284000',localTradedAt:'2026-10-22T11:50:21+09:00',marketStatus:'OPEN'}
const now=Date.parse('2026-10-22T12:00:00+09:00')
test('Korean codes preserve leading zeroes and newly issued alphanumeric codes',()=>{
 for(const code of ['005930','0053M0','0102X0','36328K'])assert(koreanEquitySymbol(code))
 for(const code of ['5930','AAPL','005930/','005930?x=1'])assert(!koreanEquitySymbol(code))
})
test('raw KRW fields take priority over rounded display units',()=>{
 const quote=koreanQuote(row,'KOSPI',now)
 assert.equal(quote.symbol,'005930');assert.equal(quote.currency,'KRW');assert.equal(quote.marketCap,1267180888284000)
 assert.equal(quote.turnover,1163476000000);assert.equal(quote.change,-6750);assert.equal(quote.changePercent,-3.02);assert.equal(quote.previousClose,223500)
 assert.equal(quote.volume,5269448);assert.equal(quote.status,'delayed');assert.equal(quote.asOf,row.localTradedAt)
})
test('display market value is 100 million KRW and missing fields stay null',()=>{
 const quote=koreanQuote({...row,marketValueRaw:null,marketValue:'1,234',accumulatedTradingVolume:'-',accumulatedTradingValue:'N/A'},'KOSPI',now)
 assert.equal(quote.marketCap,123400000000);assert.equal(quote.volume,null);assert.equal(quote.turnover,null)
 assert.equal(koreanQuote({...row,closePrice:'-'},'KOSPI',now).price,null)
})
test('Korean amount units are explicit and unrecognized values do not become zero',()=>{
 assert.equal(koreanAmount('1,267조 1,809억'),1267180900000000)
 assert.equal(koreanAmount('22조 2,211억원'),22221100000000)
 assert.equal(krNumber('22,292원'),22292);assert.equal(krNumber('9.72배'),9.72);assert.equal(krNumber('0.77%'),.77)
 for(const value of ['N/A','-',undefined,'unknown',''])assert.equal(koreanAmount(value),null)
})
test('actual daily OHLC preserves open current bar and rejects mismatched symbols',()=>{
 const quote=koreanQuote(row,'KOSPI',now),body={code:'005930',priceInfos:[{localDate:'20261021',closePrice:223500,openPrice:220000,highPrice:225000,lowPrice:219000,accumulatedTradingVolume:100},{localDate:'20261022',closePrice:216750,accumulatedTradingVolume:200}]}
 const history=koreanHistory(body,quote)
 assert.equal(history.length,2);assert.equal(history[0].isComplete,true);assert.equal(history[1].isComplete,false);assert.equal(history[0].open,220000)
 assert.deepEqual(koreanHistory({...body,code:'069500'},quote),[])
})
test('ETF is identified by provider type, with fees and NAV in original units',()=>{
 const quote=koreanQuote({...row,itemCode:'0053M0',stockName:'example',stockEndType:'etf'},'KOSPI',now)
 const item=koreanDetails(quote,{itemCode:'0053M0',stockEndType:'etf',description:'Observed fund description',etfKeyIndicator:{issuerName:'Issuer',totalFee:.15,nav:'90,091.58',totalNav:'22조 2,211억'},totalInfos:[{code:'etfBaseIdx',value:'코스피 200'}]},null)
 assert.equal(item.kind,'etf');assert.equal(item.etf.expenseRatioPercent,.15);assert.equal(item.etf.nav,90091.58);assert.equal(item.etf.totalAssets,22221100000000);assert.equal(item.fundamentals.revenue,null)
})
test('stored Korean quarter revenue converts 100 million KRW, with sentinel growth missing',()=>{
 const item=koreanFundamentals({itemCode:'005930',totalInfos:[{code:'eps',value:'22,292원',valueDesc:'2026.06.'}]},{'매출당분기':1234,'매출전년':1000,'매출증가율':.234,'EPS증가율':999,'EPS출처':'순이익','EPS당분기':500,'실적분기목록':'2026Q2|2026Q1','매출분기목록':'1234|1111','EPS분기목록':'500|400'},'2026-08-27')
 assert.equal(item.revenueUnit,'KRW');assert.equal(item.revenue,123400000000);assert.equal(item.eps,22292);assert.equal(item.epsGrowthPercent,null);assert.equal(item.quarters[0].eps,null);assert.equal(item.snapshotAsOf,'2026-08-27')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {ASSET_GROUPS,naverAsset,upbitAsset,unavailableAsset} from '../lib/terminal/assets-data.mjs'
const now=Date.parse('2026-10-21T14:00:00Z')
const apple=ASSET_GROUPS.stocks[0]
test('fixed catalog is explicit, complete and includes sector ETF identity',()=>{
  assert.equal(ASSET_GROUPS.stocks.length,20)
  assert.equal(ASSET_GROUPS.sectors.length,11)
  assert.equal(ASSET_GROUPS.crypto.length,8)
  assert.equal(new Set(Object.values(ASSET_GROUPS).flat().map(s=>s.code)).size,39)
  assert.ok(ASSET_GROUPS.sectors.every(s=>s.kind==='sector-etf'&&s.sector))
  assert.match(unavailableAsset(ASSET_GROUPS.sectors[0]).note,/지수 자체/)
})
test('missing quote cannot become zero and a mismatched symbol is never shown',()=>{
  assert.equal(naverAsset(apple,null,null,now).price,null)
  assert.equal(naverAsset(apple,{reutersCode:'MSFT.O',closePrice:100},null,now).price,null)
  const row=naverAsset(apple,{reutersCode:'AAPL.O',closePrice:'',accumulatedTradingVolumeRaw:null},null,now)
  assert.equal(row.price,null)
  assert.equal(row.volume,null)
  assert.equal(row.status,'unavailable')
})
test('Naver signed change and raw volume/market cap preserve original currency and observation time',()=>{
  const row=naverAsset(apple,{reutersCode:'AAPL.O',closePriceRaw:'100.50',compareToPreviousClosePriceRaw:'1.50',
    fluctuationsRatio:'1.47',compareToPreviousPrice:{code:'5'},localTradedAt:'2026-10-21T09:45:00-04:00',
    accumulatedTradingVolumeRaw:'1,234',marketValueFullRaw:'5000000',currencyType:{code:'USD'},delayTime:0,
    stockItemTotalInfos:[{code:'basePrice',value:'102.00'}]},null,now)
  assert.equal(row.price,100.5)
  assert.equal(row.previousClose,102)
  assert.equal(row.change,-1.5)
  assert.equal(row.changePercent,-1.47)
  assert.equal(row.volume,1234)
  assert.equal(row.marketCap,5000000)
  assert.equal(row.currency,'USD')
  assert.equal(row.status,'delayed')
  assert.equal(row.historyStatus,'unavailable')
})
test('daily source dates are sorted, invalid/missing rows removed and open session remains incomplete',()=>{
  const row=naverAsset(apple,{reutersCode:'AAPL.O',closePrice:101,localTradedAt:'2026-10-21T09:45:00-04:00',marketStatus:'OPEN'},
    {code:'AAPL.O',priceInfos:[{localDate:'20261021',closePrice:101,openPrice:100},{localDate:'20261020',closePrice:99},
      {localDate:'20260231',closePrice:90},{localDate:'20261019',closePrice:null}]},now)
  assert.deepEqual(row.history.map(p=>[p.time,p.value,p.isComplete]),[['2026-10-20',99,true],['2026-10-21',101,false]])
  assert.equal(row.history[0].volume,null)
  assert.equal(row.history[1].open,100)
})
test('old equity quote is stale even after a new HTTP fetch',()=>{
  const row=naverAsset(apple,{reutersCode:'AAPL.O',closePrice:90,localTradedAt:'2026-10-01T16:00:00-04:00'},null,now)
  assert.equal(row.status,'stale')
  assert.equal(row.asOf,'2026-10-01T16:00:00-04:00')
})
test('Upbit preserves KRW, uses signed previous-close return, and distinguishes daily from 24h volume',()=>{
  const spec=ASSET_GROUPS.crypto[0]
  const quote={market:'KRW-BTC',trade_price:99000,prev_closing_price:100000,signed_change_price:-1000,
    signed_change_rate:-0.01,acc_trade_volume:12,acc_trade_volume_24h:30,trade_timestamp:now-1000}
  const row=upbitAsset(spec,quote,[{market:'KRW-BTC',candle_date_time_utc:'2026-10-21T00:00:00',trade_price:99000},
    {market:'KRW-BTC',candle_date_time_utc:'2026-10-19T00:00:00',trade_price:100000},
    {market:'KRW-ETH',candle_date_time_utc:'2026-10-20T00:00:00',trade_price:123}],now)
  assert.equal(row.currency,'KRW')
  assert.equal(row.exchange,'UPBIT')
  assert.equal(row.changePercent,-1)
  assert.equal(row.volume,12)
  assert.equal(row.volume24h,30)
  assert.equal(row.marketCap,null)
  assert.equal(row.changeBasis,'UTC-day-close')
  assert.deepEqual(row.history.map(p=>[p.time,p.isComplete]),[['2026-10-19',true],['2026-10-21',false]])
  assert.equal(row.history.length,2,'missing day must not be filled')
})

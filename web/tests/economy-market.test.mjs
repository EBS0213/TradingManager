import test from 'node:test'
import assert from 'node:assert/strict'
import {
  economyNumber, observationDate, economySeries, pushedEconomySeries,
  naverEconomySeries, ecbEconomySeries, treasuryEconomySeries,
  treasuryFallback, krTreasurySeries,
} from '../lib/terminal/economy-market-data.mjs'

const now = Date.parse('2026-10-21T12:00:00Z')

test('missing numbers and invalid dates cannot become observations; actual zero remains zero', () => {
  for (const value of [null, undefined, '', ' ', '-', 'N/A', false, NaN, '12abc']) assert.equal(economyNumber(value), null)
  assert.equal(economyNumber('1,230.50'), 1230.5)
  assert.equal(economyNumber(0), 0)
  assert.equal(observationDate('2026-02-31'), null)
  assert.equal(observationDate('2026-10-20'), '2026-10-20')
  const row = economySeries({frequency:'daily'}, [{date:'2026-10-19',value:null},{date:'2026-10-20',value:0}], {now})
  assert.deepEqual(row.points, [{date:'2026-10-20',value:0}])
  assert.equal(row.previous,null)
  assert.equal(row.change,null)
  assert.equal(row.status,'available')
})

test('legacy collector freshness, absent Korea and uncertain source units are explicit', () => {
  const rows = pushedEconomySeries({at:'2026-08-27T06:00:00Z',groups:[{key:'us_money',side:'US',rows:[
    {name:'M2',day:'2026-07-01',value:123,chg:[{k:'MoM',v:0,p:0}]},
    {name:'본원통화',day:'2026-07-01',value:5.5,unit:'십억달러'},
  ]}]},now)
  const m2 = rows.find(r=>r.id==='FRED:M2SL')
  assert.equal(m2.status,'stale')
  assert.equal(m2.previous,null)
  assert.equal(m2.change,null)
  assert.equal(m2.asOf,'2026-07-01')
  assert.equal(rows.find(r=>r.id==='FRED:BOGMBASE').value,null)
  const korea = rows.filter(r=>r.country==='KOR')
  assert.equal(korea.length,9)
  assert.ok(korea.every(r=>r.status==='unavailable'&&r.value===null&&r.points.length===0))
})

test('Naver uses actual timestamps and direction codes, with no invented prior dates', () => {
  const rows = naverEconomySeries([{reutersCode:'GCcv1',closePrice:'4,000',fluctuations:'5',fluctuationsType:{code:'5'},
    localTradedAt:'2026-10-21T04:30:00-05:00',delayTime:10,priceDataType:'DELAYED_PRICE',unit:'USD/OZS'}],now)
  const gold = rows.find(r=>r.id==='NAVER:GCcv1')
  assert.equal(gold.value,4000)
  assert.equal(gold.previous,4005)
  assert.equal(gold.change,-5)
  assert.deepEqual(gold.points,[{date:'2026-10-21T04:30:00-05:00',value:4000}])
  assert.match(gold.name,/선물/)
  assert.match(gold.note,/10분 지연/)
  assert.equal(rows.filter(r=>r.status==='unavailable').length,17)
  const kr = krTreasurySeries({closePrice:'4.1',fluctuations:'-0.05',fluctuationsType:{code:'5'},localTradedAt:'2026-10-21T15:30:00+09:00'},now)
  assert.equal(kr.change,-0.05)
  assert.equal(kr.unit,'%')
})

test('expanded commodities preserve observed cents, pounds and energy units without conversions', () => {
  const quotes = [
    ['SIcv1','USD/OZS','56.91','DELAYED_PRICE'], ['HGcv1','USD/LBS','6.5160','DELAYED_PRICE'],
    ['NGcv1','USD/MMBTU','2.79','CLOSING_PRICE'], ['Ccv1','USc/BSH','463.25','CLOSING_PRICE'],
    ['Wcv1','USc/BSH','628.25','CLOSING_PRICE'], ['Scv1','USc/BSH','1,245.25','CLOSING_PRICE'],
  ].map(([reutersCode,unit,closePrice,priceDataType]) => ({reutersCode,unit,closePrice,priceDataType,
    localTradedAt:'2026-10-21T04:30:00-05:00',fluctuations:'1.25',fluctuationsType:{code:'5'}}))
  const rows = naverEconomySeries(quotes,now)
  for (const quote of quotes) {
    const row = rows.find(r=>r.id===`NAVER:${quote.reutersCode}`)
    assert.equal(row.unit,quote.unit)
    assert.equal(row.value,economyNumber(quote.closePrice))
    assert.equal(row.change,-1.25)
    assert.equal(row.asOf,quote.localTradedAt)
    assert.equal(row.status,'available')
  }
  const corn = rows.find(r=>r.id==='NAVER:Ccv1')
  assert.equal(corn.value,463.25)
  assert.equal(corn.previous,464.5)
  assert.equal(corn.frequency,'daily')
  assert.match(corn.note,/미국 센트\/부셸/)
  assert.match(corn.note,/일별 마감값/)
  assert.match(rows.find(r=>r.id==='NAVER:HGcv1').note,/달러\/파운드/)
})

test('commodity unit mismatches, missing data and missing observation dates fail closed', () => {
  const base = {reutersCode:'Ccv1',unit:'USc/BSH',closePrice:'463.25',localTradedAt:'2026-10-21T04:30:00-05:00'}
  for (const altered of [{unit:'USD/BSH'},{unit:undefined},{closePrice:'-'},{localTradedAt:null}]) {
    const row = naverEconomySeries([{...base,...altered}],now).find(r=>r.id==='NAVER:Ccv1')
    assert.equal(row.status,'unavailable')
    assert.equal(row.value,null)
    assert.equal(row.previous,null)
    assert.equal(row.change,null)
    assert.equal(row.asOf,null)
    assert.deepEqual(row.points,[])
  }
  const duplicate = naverEconomySeries([{...base,closePrice:'450',localTradedAt:'2026-10-20T04:30:00-05:00'},base],now)
    .find(r=>r.id==='NAVER:Ccv1')
  assert.equal(duplicate.value,463.25)
  assert.equal(duplicate.points.length,1)
  const krGold = naverEconomySeries([{...base,reutersCode:'M04020000',unit:'원/g',closePrice:'175,300'}],now)
    .find(r=>r.id==='NAVER:M04020000')
  assert.equal(krGold.unit,'KRW/g')
  assert.equal(krGold.value,175300)
})

test('ECB cross rates use same-date observations and reject missing/zero denominators', () => {
  const rows = ecbEconomySeries({base:'USD',amount:1,rates:{
    '2026-10-19':{KRW:1400,JPY:140,EUR:0.8,CNY:7},
    '2026-10-20':{KRW:1500,JPY:0,EUR:null,CNY:7.5},
  }},now)
  assert.equal(rows.find(r=>r.id==='ECB:USDKRW').value,1500)
  assert.equal(rows.find(r=>r.id==='ECB:USDKRW').change,100)
  const yen = rows.find(r=>r.id==='ECB:JPYKRW')
  assert.equal(yen.value,1000)
  assert.equal(yen.asOf,'2026-10-19')
  assert.equal(yen.points.length,1)
  assert.equal(rows.find(r=>r.id==='ECB:EURKRW').value,1750)
  assert.ok(ecbEconomySeries({base:'EUR',amount:1,rates:{'2026-10-20':{KRW:1400}}},now).every(r=>r.value===null))
})

test('Treasury CSV follows headers and observed dates, including genuine zero yields', () => {
  const rows = treasuryEconomySeries('"Date","30 Yr","10 Yr","2 Yr","3 Mo"\n"10/20/2026","5.2","4.9","4.4","0"\n"10/19/2026","5.3","5.0","N/A","0.1"\n',now)
  const ten = rows.find(r=>r.id==='UST:10Y')
  assert.equal(ten.value,4.9)
  assert.equal(ten.previous,5)
  assert.equal(ten.change,-0.1)
  assert.equal(ten.asOf,'2026-10-20')
  assert.equal(rows.find(r=>r.id==='UST:3MO').value,0)
  const spread = rows.find(r=>r.id==='UST:10Y_2Y')
  assert.deepEqual(spread.points,[{date:'2026-10-20',value:0.5}])
  assert.equal(spread.previous,null)
  assert.equal(rows.find(r=>r.id==='UST:1MO').status,'unavailable')
  assert.ok(treasuryEconomySeries('<html>rate limited</html>',now).every(r=>r.value===null))
})

test('Treasury fallback keeps source/date and marks even recently saved data stale after fetch failure', () => {
  const empty = treasuryEconomySeries('',now)
  const legacy = pushedEconomySeries({at:'2026-08-27T00:00:00Z',groups:[{key:'us_rate',side:'US',rows:[{name:'미국 국채 2년',value:4.2,day:'2026-08-26'}]}]},now)
  const rows = treasuryFallback(empty,{items:[{key:'US10Y',value:5.1,day:'10/20/2026'}]},legacy,now)
  const ten=rows.find(r=>r.id==='UST:10Y'), two=rows.find(r=>r.id==='UST:2Y')
  assert.equal(ten.value,5.1)
  assert.equal(ten.status,'stale')
  assert.equal(ten.asOf,'2026-10-20')
  assert.match(ten.source.name,/재무부/)
  assert.equal(two.value,4.2)
  assert.equal(two.status,'stale')
  assert.match(two.source.name,/FRED/)
  assert.equal(rows.find(r=>r.id==='UST:1Y').value,null)
})

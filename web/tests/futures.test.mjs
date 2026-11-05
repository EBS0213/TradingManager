import test from 'node:test';
import assert from 'node:assert/strict';
import { FUTURES, naverFuture, domesticFuture, nightFuture, futureHistory, dayFuture } from '../lib/terminal/futures.mjs';
const now = '2026-10-23T04:30:00Z';
test('CME prices preserve sign, contract and source time, with explicit delay', () => {
  const item = naverFuture(FUTURES[0], { reutersCode: 'NQcv1', closePrice: '29,182.75', fluctuationsRatio: '-0.14', localTradedAt: '2026-10-22T23:20:00-05:00', delayTime: 10, marketStatus: 'OPEN', month: '26.12.' }, now);
  assert.equal(item.price, 29182.75);
  assert.equal(item.changePercent, -0.14);
  assert.equal(item.asOf, '2026-10-23T04:20:00.000Z');
  assert.equal(item.status, 'delayed');
  assert.equal(item.delayMinutes, 10);
  assert.equal(item.contract, '26.12.');
  assert.equal(naverFuture(FUTURES[1], { reutersCode: 'NQcv1', closePrice: '29182' }, now).price, null);
});
test('unknown domestic timestamps and delay are never presented as realtime', () => {
  const item = domesticFuture(FUTURES[2], [{ key: 'krnight', value: '852.15', pct: '-0.57%', session: '주간' }], now);
  assert.equal(item.price, 852.15);
  assert.equal(item.changePercent, -0.57);
  assert.equal(item.asOf, null);
  assert.equal(item.status, 'unknown');
  assert.equal(item.session, '주간');
  assert.equal(domesticFuture(FUTURES[2], [{ key: 'krnight', value: '', session: '야간' }], now).price, null);
  assert.equal(domesticFuture(FUTURES[3], [{ key: 'krnight', value: '852', session: '주간' }], now).price, null);
});
test('night session uses its own observation time and flags stopped updates', () => {
  const quote = { ok: true, last: 1255, pct: -2.36, ts: Date.parse('2026-10-22T21:00:00Z'), contract: 'A06612', freshness: { marketState: 'closed', sourceState: 'current' } };
  const item = nightFuture(FUTURES[4], { kospi: quote }, now);
  assert.equal(item.price, 1255);
  assert.equal(item.asOf, '2026-10-22T21:00:00.000Z');
  assert.equal(item.marketStatus, 'CLOSED');
  assert.equal(nightFuture(FUTURES[4], { kospi: { ...quote, freshness: { marketState: 'open', sourceState: 'current' } } }, now).status, 'stale');
  assert.equal(nightFuture(FUTURES[4], { kosdaq: quote }, now).price, null);
});
test('stale CME quotes and missing values do not become fresh zero quotes', () => {
  const quote = { reutersCode: 'EScv1', closePrice: '7,700', localTradedAt: '2026-10-22T23:00:00-05:00', delayTime: 10, marketStatus: 'OPEN' };
  assert.equal(naverFuture(FUTURES[1], quote, now).status, 'stale');
  assert.equal(naverFuture(FUTURES[1], { ...quote, closePrice: '' }, now).status, 'unavailable');
  assert.equal(naverFuture(FUTURES[1], { ...quote, closePrice: '—' }, now).price, null);
});
test('futures chart requires the matching futures instrument and keeps valid OHLC data',()=>{
  const body={code:'NQcv1',infoType:'futures',priceInfos:[
    {localDate:'20261022',closePrice:29094.75,openPrice:29984,highPrice:29993.25,lowPrice:29033,accumulatedTradingVolume:822661},
    {localDate:'20260230',closePrice:1},{localDate:'20261023',closePrice:0}]};
  const points=futureHistory(FUTURES[0],body);
  assert.equal(points.length,1);assert.equal(points[0].time,'2026-10-22');assert.equal(points[0].high,29993.25);
  assert.equal(futureHistory(FUTURES[1],body).length,0);
  assert.equal(futureHistory(FUTURES[0],{...body,infoType:'index'}).length,0);
});
test('night chart uses real minute timestamps and never invents daily candles',()=>{
  const minute=Date.parse('2026-10-22T09:00:00Z')/60000;
  const body={kospi:{ok:true,ts:(minute+1)*60000,hist:[[minute,1282],[minute+1,1283],[minute+5,1284],[minute,-1]]}};
  const points=futureHistory(FUTURES[4],body);
  assert.equal(points.length,2);assert.equal(points[0].time,'2026-10-22T09:00:00.000Z');
  assert.equal(points[1].value,1283);assert.equal(points[0].open,undefined);
  assert.equal(futureHistory(FUTURES[4],{kosdaq:body.kospi}).length,0);
});

test('day quotes and chart share the same session, even when the quote feed switches to night',()=>{
  assert.equal(domesticFuture(FUTURES[2],[{key:'krnight',value:'864.5',session:'야간'}],now).price,null);
  const body=[{date:'20261023',close:863.3},{date:'20261026',close:850}];
  const item=dayFuture(FUTURES[2],body,now);
  assert.equal(item.price,850);assert.equal(item.session,'주간');
  assert.equal(item.previousClose,863.3);assert.equal(item.history.at(-1).value,item.price);
  assert.ok(item.changePercent<0);assert.equal(dayFuture(FUTURES[2],[],now).price,null);
  assert.equal(FUTURES[4].symbol,'K200-NIGHT');
});

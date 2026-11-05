import test from 'node:test'
import assert from 'node:assert/strict'
import {nextCallAlertTime,callAlertKey,formatCallAlert,callAlertEligible} from '../lib/terminal/call-alert-data.mjs'

test('call alerts defer across the hourly news window including midnight',()=>{
  for(const [input,want] of [
    ['2026-10-23T15:54:59+09:00','2026-10-23T06:54:59.000Z'],
    ['2026-10-23T15:55:00+09:00','2026-10-23T07:05:00.000Z'],
    ['2026-10-23T16:00:00+09:00','2026-10-23T07:05:00.000Z'],
    ['2026-10-23T16:04:59+09:00','2026-10-23T07:05:00.000Z'],
    ['2026-10-23T16:05:00+09:00','2026-10-23T07:05:00.000Z'],
    ['2026-10-23T23:59:59+09:00','2026-10-23T15:05:00.000Z'],
  ])assert.equal(nextCallAlertTime(input).toISOString(),want)
})
test('one ticker and fiscal quarter retain the same notification identity on regeneration',()=>{
  assert.equal(callAlertKey({code:'WDC',quarter:'2027 회계연도 1분기'}),'WDC:2027Q1')
  assert.equal(callAlertKey({code:'WDC',quarter:'2027년 1분기'}),'WDC:2027Q1')
})
test('missing criteria cannot broadcast every completed company',()=>{
  assert.equal(callAlertEligible({code:'WDC'},null).pending,true)
  assert.equal(callAlertEligible({code:'WDC'},{enabled:true,kind:'symbols',symbols:['WDC']}).eligible,true)
  assert.equal(callAlertEligible({code:'NEM'},{enabled:true,kind:'symbols',symbols:['WDC']}).eligible,false)
})
test('Telegram company messages escape HTML and remain within message length',()=>{
  const text=formatCallAlert({code:'WDC',name:'A&B <company>',quarter:'2027 회계연도 1분기',date:'2026-10-22',
    headline:'성장',summary:'요약'.repeat(3000),numbers:[{k:'매출',v:'4.4십억 달러',note:'55% 증가'}]})
  assert.match(text,/A&amp;B &lt;company&gt;/);assert(text.length<3500)
  assert.match(text,/https:\/\/www.tradingmanagerkr.com\/#terminal\/calls/)
})

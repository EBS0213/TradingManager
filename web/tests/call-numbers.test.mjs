import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeCallNumbers} from '../lib/call-numbers.mjs'
test('guidance ranges and notes survive publication without truncated financial values',()=>{
 const numbers=[{k:'2026년 손익 성장 가이던스',v:'순이자이익 19~21% / 비이자이익 12~14% / 비이자비용 19~20%',note:'2025년 Associated 단독 연간 실적 대비; 비용에 인수 관련 비경상 비용 포함'}]
 assert.deepEqual(normalizeCallNumbers(numbers),numbers)
 assert.throws(()=>normalizeCallNumbers([{v:'1'.repeat(6001)}]),/너무 깁니다/)
})

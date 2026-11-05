import test from 'node:test'
import assert from 'node:assert/strict'
import {COUNTRY_CODES, getCountryEconomy} from '../lib/terminal/economy-country.mjs'

const now = new Date('2026-10-21T00:00:00Z')
const GDP = 'NY.GDP.MKTP.KD.ZG'
const row = (date, value, id = GDP, country = 'KOR') => ({date, value, indicator: {id}, countryiso3code: country})
const response = payload => ({ok: true, json: async () => payload})
const wbResponse = rows => response([{page: 1, pages: 1}, rows])
const imfResponse = (url, values) => {
  const [indicator, country] = new URL(url).pathname.split('/').slice(-2)
  return response({values: {[indicator]: {[country]: values}}})
}
const options = fetchImpl => ({fetchImpl, now})

test('country allowlist rejects injection and unsupported codes before network access', async () => {
  assert.equal(COUNTRY_CODES.length, 12)
  let called = false
  await assert.rejects(getCountryEconomy('KOR/indicator/anything', options(async () => {called = true})), RangeError)
  await assert.rejects(getCountryEconomy('ZZZ', options(async () => {called = true})), RangeError)
  assert.equal(called, false)
})

test('one source=2 request preserves real zero, null holes, stable ids, and past/current years only', async () => {
  let calls = 0
  const result = await getCountryEconomy('kor', options(async (url, init) => {
    calls++
    const parsed = new URL(url)
    assert.equal(parsed.hostname, 'api.worldbank.org')
    assert.equal(parsed.searchParams.get('source'), '2')
    assert.equal(parsed.searchParams.get('date'), '2010:2026')
    assert.equal(init.cache, 'no-store')
    assert.ok(init.signal instanceof AbortSignal)
    return wbResponse([row('2025', 0), row('2024', -1), row('2023', null), row('2027', 99), row('2009', 10), row('2025', 100, GDP, 'USA')])
  }))
  assert.equal(calls, 1)
  assert.equal(result.series.length, 8)
  const metric = result.series[0]
  assert.equal(metric.id, GDP)
  assert.deepEqual(metric.points, [{date: '2023', value: null}, {date: '2024', value: -1}, {date: '2025', value: 0}])
  assert.equal(metric.value, 0)
  assert.equal(metric.previous, -1)
  assert.equal(metric.change, 1)
  assert.equal(result.series[1].value, null)
  assert.equal(result.series[1].status, 'unavailable')
})

test('two-year annual release lag remains available; observations over three years old are stale', async () => {
  for (const [year, expected] of [['2024', 'available'], ['2023', 'available'], ['2022', 'stale']]) {
    const result = await getCountryEconomy('KOR', options(async () => wbResponse([row(year, 1)])))
    assert.equal(result.series[0].status, expected)
    if (expected === 'stale') assert.match(result.series[0].note, /3년을 초과/)
  }
})

test('change is not computed across a missing year and malformed values never become zero', async () => {
  const result = await getCountryEconomy('KOR', options(async () => wbResponse([
    row('2025', 3), row('2024', null), row('2023', 1), row('2026', ''), row('2022', false), row('2021', 'NaN'),
  ])))
  assert.equal(result.series[0].value, 3)
  assert.equal(result.series[0].asOf, '2025')
  assert.equal(result.series[0].previous, null)
  assert.equal(result.series[0].change, null)
  assert.equal(result.series[0].points.find(point => point.date === '2022').value, null)
})

test('World Bank failure uses bounded IMF requests with distinct ids and verified original units', async () => {
  let active = 0, peak = 0, calls = 0
  const result = await getCountryEconomy('WLD', options(async url => {
    calls++
    if (url.includes('worldbank')) throw new Error('unavailable')
    assert.match(url, /\/WEOWORLD$/)
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 1))
    active--
    return imfResponse(url, {'2024': 100, '2025': 0, '2026': 200, '2031': 500})
  }))
  assert.equal(calls, 8)
  assert.ok(peak <= 4)
  assert.equal(result.series.length, 7)
  assert.ok(result.series.every(metric => metric.id.startsWith('IMF_') && metric.asOf === '2025' && metric.country === 'WLD'))
  assert.ok(result.series.every(metric => metric.points.every(point => Number(point.date) < 2026)))
  assert.ok(result.series.every(metric => /추정치가 포함될 수 있음/.test(metric.note)))
  assert.equal(result.series.find(metric => metric.id === 'IMF_NGDPD').unit, '10억 달러')
  assert.equal(result.series.find(metric => metric.id === 'IMF_LP').unit, '백만 명')
  assert.equal(result.sources[0].status, 'unavailable')
  assert.equal(result.sources[1].status, 'available')
})

test('all-null or incomplete World Bank response cannot suppress usable IMF data', async () => {
  for (const wb of [[{pages: 1}, [row('2025', null)]], [{pages: 2}, [row('2025', 10)]]]) {
    const result = await getCountryEconomy('KOR', options(async url => url.includes('worldbank') ? response(wb) : imfResponse(url, {'2025': 2})))
    assert.equal(result.series[0].id, 'IMF_NGDP_RPCH')
    assert.equal(result.series[0].value, 2)
  }
})

test('total source outage returns explicit unavailable rows and no invented values', async () => {
  const result = await getCountryEconomy('USA', options(async () => {throw new Error('offline')}))
  assert.equal(result.series.length, 7)
  assert.ok(result.series.every(metric => metric.value === null && metric.previous === null && metric.change === null && metric.status === 'unavailable'))
  assert.ok(result.sources.every(source => source.status === 'unavailable'))
  assert.equal(result.errors.length, 8)
})

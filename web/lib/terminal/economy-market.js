import { getSql } from '@/lib/db'
import { readPushed } from '@/lib/macrofeed'
import {
  pushedEconomySeries, naverEconomySeries, ecbEconomySeries,
  treasuryEconomySeries, treasuryFallback, treasuryUrl, krTreasurySeries,
} from './economy-market-data.mjs'

const MARKET_URL = 'https://stock.naver.com/api/securityService/marketindex/majors/rpc'
const COMMODITY_URLS = ['metals', 'energy', 'agricultural'].map(category =>
  `https://stock.naver.com/api/securityService/marketindex/${category}`)
const KR_BOND_URL = 'https://api.stock.naver.com/marketindex/bond/KR10YT%3DRR'
const headers = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*', Referer: 'https://stock.naver.com/market/marketindex' }

async function readStored() {
  if (!process.env.DATABASE_URL) return { pushed: null, bond: null }
  try {
    const sql = await getSql()
    const [pushed, rows] = await Promise.all([readPushed(sql), sql`SELECT value FROM screener_settings WHERE key = 'bond'`])
    return { pushed, bond: rows[0]?.value ?? null }
  } catch { return { pushed: null, bond: null } }
}

async function boundedStored() {
  let timer
  try {
    return await Promise.race([readStored(), new Promise(resolve => { timer = setTimeout(() => resolve({ pushed: null, bond: null }), 2000) })])
  } finally { clearTimeout(timer) }
}

/** The route owns its 15-minute cache/singleflight. This helper only reads data.
 * Seven fixed public requests run at most four at a time, each for at most 8 seconds,
 * within one 20-second deadline. Commodity category lists avoid per-symbol fanout.
 * No API keys, database writes, recursive requests to our own route, or timers survive completion.
 */
export async function getMarketEconomy() {
  const now = Date.now(), errors = [], year = new Date(now).getUTCFullYear()
  const deadline = AbortSignal.timeout(20_000)
  const start = new Date(now - 31 * 86_400_000).toISOString().slice(0,10)
  const fxUrl = `https://api.frankfurter.dev/v1/${start}..?from=USD&to=KRW,JPY,EUR,CNY`
  async function load(url, name, json = true) {
    try {
      const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.any([deadline, AbortSignal.timeout(8000)]) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return json ? await response.json() : await response.text()
    } catch {
      errors.push(`${name}: 제공처 응답을 받지 못했습니다.`)
      return null
    }
  }
  const requests = [
    [MARKET_URL, '네이버 시장지표'], [fxUrl, 'ECB 기준환율'],
    [treasuryUrl(year), '미국 재무부 수익률 곡선', false], [KR_BOND_URL, '한국 국고채'],
    ...COMMODITY_URLS.map((url, index) => [url, ['네이버 금속', '네이버 에너지', '네이버 농축산물'][index]]),
  ]
  const results = new Array(requests.length)
  let cursor = 0
  const [, stored] = await Promise.all([
    Promise.all(Array.from({length: 4}, async () => {
      while (cursor < requests.length) {
        const index = cursor++
        results[index] = await load(...requests[index])
      }
    })),
    boundedStored(),
  ])
  const [market, fx, csv, koreaBond, ...commodities] = results
  const marketQuotes = [market, ...commodities].flatMap(rows => Array.isArray(rows) ? rows : [])
  const pushed = pushedEconomySeries(stored.pushed, now)
  if (!stored.pushed?.groups?.length) errors.push('기존 US/KR 거시 수집본이 없습니다. 미수집 지표는 빈 값으로 표시합니다.')
  else if (pushed.some(s => s.status === 'stale')) errors.push('기존 US/KR 거시 수집본에 오래된 관측치가 포함되어 있습니다.')
  const treasury = treasuryFallback(treasuryEconomySeries(csv ?? '', now), stored.bond, pushed, now)
  if (csv && treasury.every(s => s.status !== 'available')) errors.push('미국 재무부 응답에서 최신 수익률 곡선을 확인하지 못했습니다.')
  // Old FRED yields are only fallback data for the same tenor, never duplicate live rows.
  const duplicated = new Set(['DGS3MO','DGS2','DGS10','DGS30','T10Y2Y','T10Y3M'].map(id => `FRED:${id}`))
  return {
    series: [
      ...pushed.filter(s => !duplicated.has(s.id)), ...treasury,
      krTreasurySeries(koreaBond, now), ...naverEconomySeries(marketQuotes, now), ...ecbEconomySeries(fx, now),
    ],
    fetchedAt: new Date().toISOString(), errors,
  }
}

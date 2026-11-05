// Independent adapters using the providers' documented public HTTP contracts.
// World Bank: https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures
// IMF: https://www.imf.org/external/datamapper/api/help
// No Fincept implementation is imported or copied. Persistent caching belongs to the caller.
export const COUNTRY_CODES = Object.freeze(['USA', 'KOR', 'JPN', 'CHN', 'DEU', 'GBR', 'IND', 'CAN', 'FRA', 'AUS', 'BRA', 'WLD'])
const WB_BASE = 'https://api.worldbank.org/v2'
const IMF_BASE = 'https://www.imf.org/external/datamapper/api/v1'
const START_YEAR = 2010
const IMF_NOTE = 'IMF WEO 시계열: 추정치가 포함될 수 있음. 현재 연도 및 미래 전망은 제외했습니다.'
const WB = [
  ['NY.GDP.MKTP.KD.ZG', '실질 GDP 성장률', '%'],
  ['FP.CPI.TOTL.ZG', '소비자물가 상승률', '%'],
  ['SL.UEM.TOTL.ZS', '실업률 (ILO 모형 추정)', '%'],
  ['NY.GDP.MKTP.CD', '명목 GDP', '달러'],
  ['NY.GDP.PCAP.CD', '1인당 명목 GDP', '달러/명'],
  ['BN.CAB.XOKA.GD.ZS', '경상수지 / GDP', '%'],
  ['SP.POP.TOTL', '인구', '명'],
  ['NE.EXP.GNFS.ZS', '상품·서비스 수출 / GDP', '%'],
]
// Original units verified against IMF /indicators metadata on 2026-10-21.
const IMF = [
  ['NGDP_RPCH', '실질 GDP 성장률', '%'],
  ['PCPIPCH', '평균 소비자물가 상승률', '%'],
  ['LUR', '실업률', '%'],
  ['NGDPD', '명목 GDP', '10억 달러'],
  ['NGDPDPC', '1인당 명목 GDP', '달러/명'],
  ['BCA_NGDPD', '경상수지 / GDP', '%'],
  ['LP', '인구', '백만 명'],
]

function valueOrNull(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
function annualPoints(entries, finalYear) {
  const values = new Map()
  for (const [date, value] of entries) {
    const year = String(date)
    if (!/^\d{4}$/.test(year) || Number(year) < START_YEAR || Number(year) > finalYear) continue
    const parsed = valueOrNull(value)
    // An empty duplicate must not erase a genuine zero or other observation.
    if (!values.has(year) || parsed !== null) values.set(year, parsed)
  }
  return [...values].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({date, value}))
}
function makeSeries(spec, country, points, currentYear, provider, note = '') {
  const [code, name, unit] = spec
  const latest = points.findLast(point => point.value !== null)
  const previous = latest ? points.find(point => Number(point.date) === Number(latest.date) - 1)?.value ?? null : null
  const status = !latest ? 'unavailable' : currentYear - Number(latest.date) > 3 ? 'stale' : 'available'
  const staleNote = status === 'stale' ? `마지막 관측 연도 ${latest.date}: 현재 기준 3년을 초과한 연간 자료입니다.` : ''
  const missingNote = !latest ? '조회 범위의 공개 관측값이 없습니다.' : ''
  const isImf = provider === 'IMF'
  return {
    id: isImf ? `IMF_${code}` : code, name, category: 'country', country, unit, frequency: '연간', points,
    value: latest?.value ?? null, previous,
    // Absolute difference in the displayed unit, not a percentage growth conversion.
    change: latest && previous !== null ? latest.value - previous : null,
    asOf: latest?.date ?? null, status,
    source: {
      name: isImf ? 'IMF WEO (DataMapper)' : 'World Bank',
      url: isImf ? `https://www.imf.org/external/datamapper/${code}@WEO/${country === 'WLD' ? 'WEOWORLD' : country}`
        : `https://data.worldbank.org/indicator/${code}?locations=${country}`,
    },
    note: [note, staleNote, missingNote].filter(Boolean).join(' '),
  }
}
async function requestJson(url, fetchImpl, timeout, deadline) {
  const response = await fetchImpl(url, {
    headers: {Accept: 'application/json'}, cache: 'no-store',
    signal: AbortSignal.any([AbortSignal.timeout(timeout), deadline]),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}
async function worldBank(country, currentYear, fetchImpl, deadline) {
  const query = new URLSearchParams({source: '2', format: 'json', date: `${START_YEAR}:${currentYear}`, per_page: '2000'})
  const url = `${WB_BASE}/country/${country}/indicator/${WB.map(([id]) => id).join(';')}?${query}`
  const payload = await requestJson(url, fetchImpl, 6000, deadline)
  if (!Array.isArray(payload) || !payload[0] || !Array.isArray(payload[1]) || Number(payload[0].pages) > 1) {
    throw new Error('응답 형식 또는 페이지 범위 오류')
  }
  const series = WB.map(spec => {
    const rows = payload[1].filter(row => row?.indicator?.id === spec[0] && row.countryiso3code === country)
    const points = annualPoints(rows.map(row => [row.date, row.value]), currentYear)
    return makeSeries(spec, country, points, currentYear, 'WB', '연간 자료이며 발표 지연·개정이 있을 수 있습니다. 변화는 직전 연도 대비 원단위 차이입니다.')
  })
  if (!series.some(row => row.value !== null)) throw new Error('조회 범위의 공개 관측값 없음')
  return series
}
async function imfFallback(country, currentYear, fetchImpl, deadline) {
  const target = country === 'WLD' ? 'WEOWORLD' : country
  const results = new Array(IMF.length)
  const errors = []
  let cursor = 0
  const worker = async () => {
    while (cursor < IMF.length) {
      const index = cursor++
      const spec = IMF[index]
      let entries = []
      try {
        const payload = await requestJson(`${IMF_BASE}/${spec[0]}/${target}`, fetchImpl, 5000, deadline)
        const values = payload?.values?.[spec[0]]?.[target]
        if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('관측값 없음')
        entries = Object.entries(values)
      } catch (error) {
        errors.push(`IMF ${spec[0]}: ${error?.name === 'TimeoutError' || error?.name === 'AbortError' ? '조회 시간 초과' : '자료를 가져오지 못했습니다'}`)
      }
      results[index] = makeSeries(spec, country, annualPoints(entries, currentYear - 1), currentYear, 'IMF', IMF_NOTE)
    }
  }
  await Promise.all(Array.from({length: 4}, worker))
  return {series: results, errors}
}

export async function getCountryEconomy(country, {fetchImpl = globalThis.fetch, now = new Date()} = {}) {
  const code = typeof country === 'string' ? country.trim().toUpperCase() : ''
  if (!COUNTRY_CODES.includes(code)) throw new RangeError('지원하지 않는 국가 코드입니다')
  const date = new Date(now)
  if (!Number.isFinite(date.getTime())) throw new TypeError('유효한 조회 시점이 필요합니다')
  const fetchedAt = date.toISOString()
  const currentYear = date.getUTCFullYear()
  const deadline = AbortSignal.timeout(19_000)
  try {
    const series = await worldBank(code, currentYear, fetchImpl, deadline)
    return {series, fetchedAt, errors: [], sources: [{name: 'World Bank', status: 'available', url: WB_BASE}]}
  } catch {
    const fallback = await imfFallback(code, currentYear, fetchImpl, deadline)
    const available = fallback.series.filter(row => row.value !== null)
    const status = !available.length ? 'unavailable' : available.every(row => row.status === 'stale') ? 'stale' : 'available'
    const detail = 'World Bank 응답을 확인하지 못해 IMF DataMapper 대체 자료를 조회했습니다. 두 제공처의 지표 정의·단위는 다를 수 있습니다.'
    return {
      ...fallback, fetchedAt, errors: [detail, ...fallback.errors],
      sources: [{name: 'World Bank', status: 'unavailable', url: WB_BASE, detail},
        {name: 'IMF WEO (DataMapper)', status, url: IMF_BASE}],
    }
  }
}

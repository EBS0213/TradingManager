// Observed economic data only. Missing inputs must never become numeric zero.
export function economyNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim().replaceAll(',', '')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

export function observationDate(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(text)) return null
  if (!Number.isFinite(Date.parse(text))) return null
  const date = text.slice(0, 10)
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null
  return text
}

export function economySeries(spec, rawPoints = [], options = {}) {
  const points = [...new Map(rawPoints.flatMap(point => {
    const date = observationDate(point?.date), value = economyNumber(point?.value)
    return date && value !== null ? [[date, { date, value }]] : []
  })).values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  const latest = points.at(-1), previousPoint = points.at(-2)
  const value = latest?.value ?? null
  const previous = value === null ? null : economyNumber(options.previous ?? previousPoint?.value)
  const now = options.now ?? Date.now()
  const maxAge = { intraday: 5, daily: 7, weekly: 21, monthly: 100, quarterly: 200, annual: 800 }[spec.frequency] ?? 7
  const old = latest && now - Date.parse(latest.date) > maxAge * 86_400_000
  return {
    ...spec, points, value, previous,
    change: value !== null && previous !== null ? Number((value - previous).toPrecision(12)) : null,
    asOf: latest?.date ?? null,
    status: value === null ? 'unavailable' : options.stale || old ? 'stale' : 'available',
    ...(options.note ? { note: options.note } : {}),
  }
}

const fredSource = { name: 'FRED · 기존 TM26 수집', url: 'https://fred.stlouisfed.org/' }
const ecosSource = { name: '한국은행 ECOS · 기존 TM26 수집', url: 'https://ecos.bok.or.kr/' }
// Expected indicators remain visible even when the optional Seoul collection has stopped.
const EXPECTED = [
  ['us_gdp','GDP','GDP','quarterly','macro','십억달러'],
  ['us_gdp','실질GDP','GDPC1','quarterly','macro','십억달러'],
  ['us_gdp','실질GDP성장률','A191RL1Q225SBEA','quarterly','macro','%'],
  ['us_money','본원통화','BOGMBASE','monthly','macro','단위 검증 대기'],
  ['us_money','M1','M1SL','monthly','macro','십억달러'],
  ['us_money','M2','M2SL','monthly','macro','십억달러'],
  ['us_money','통화유통속도','M2V','quarterly','macro','배'],
  ['us_fx','달러인덱스','DTWEXBGS','daily','fx','지수'],
  ['us_fx','유로/달러','DEXUSEU','daily','fx','USD/EUR'],
  ['us_fx','달러/엔','DEXJPUS','daily','fx','JPY/USD'],
  ['us_fx','달러/위안','DEXCHUS','daily','fx','CNY/USD'],
  ['us_fx','달러/원','DEXKOUS','daily','fx','KRW/USD'],
  ['us_rate','기준금리 상단','DFEDTARU','daily','rates','%'],
  ['us_rate','미국 국채 3개월','DGS3MO','daily','rates','%'],
  ['us_rate','미국 국채 2년','DGS2','daily','rates','%'],
  ['us_rate','미국 국채 10년','DGS10','daily','rates','%'],
  ['us_rate','미국 국채 30년','DGS30','daily','rates','%'],
  ['us_rate','10년－2년','T10Y2Y','daily','rates','%p'],
  ['us_rate','10년－3개월','T10Y3M','daily','rates','%p'],
  ['us_cpi','CPI','CPIAUCSL','monthly','macro','지수'],
  ['us_cpi','Core CPI','CPILFESL','monthly','macro','지수'],
  ['us_cpi','Core PCE','PCEPILFE','monthly','macro','지수'],
  ['us_cpi','PPI','PPIACO','monthly','macro','지수'],
  ['us_job','실업률','UNRATE','monthly','macro','%'],
  ['us_job','비농업고용','PAYEMS','monthly','macro','천명'],
  ['us_job','신규실업수당청구','ICSA','weekly','macro','건'],
  ['us_job','소매판매','RSAFS','monthly','macro','백만달러'],
  ['kr_rate','한국은행 기준금리','BOK_BASE_RATE','monthly','rates','%'],
  ['kr_rate','국고채 3년','KTB_3Y','daily','rates','%'],
  ['kr_rate','국고채 10년','KTB_10Y','daily','rates','%'],
  ['kr_rate','회사채 3년(AA-)','CORPORATE_AA_3Y','daily','rates','%'],
  ['kr_cpi','소비자물가지수','CPI','monthly','macro','지수'],
  ['kr_cpi','실업률','UNEMPLOYMENT','monthly','macro','%'],
  ['kr_money','M2(평잔)','M2','monthly','macro','십억원'],
  ['kr_money','경상수지','CURRENT_ACCOUNT','monthly','macro','백만달러'],
  ['kr_money','수출','EXPORTS','monthly','macro','천달러'],
]

function legacySpec(group, row, known) {
  const korea = group.side === 'KR' || group.key.startsWith('kr_')
  return {
    id: `${korea ? 'ECOS' : 'FRED'}:${known?.[2] ?? `${group.key}:${row.name}`}`,
    name: known?.[2] === 'DTWEXBGS' ? '광의 달러지수 (FRED)' : row.name,
    category: known?.[4] ?? (/rate|policy|spread/.test(group.key) ? 'rates' : /fx/.test(group.key) ? 'fx' : 'macro'),
    country: korea ? 'KOR' : 'USA', unit: known?.[5] || row.unit || '',
    frequency: known?.[3] ?? 'unknown', source: korea ? ecosSource : fredSource,
  }
}

export function pushedEconomySeries(pushed, now = Date.now()) {
  const groups = (Array.isArray(pushed?.groups) ? pushed.groups : []).filter(g => /^(us|kr)_/.test(g?.key ?? ''))
  const updatedAt = observationDate(pushed?.at)
  const stale = !updatedAt || now - Date.parse(updatedAt) > 3 * 86_400_000
  const result = [], used = new Set()
  const put = (group, row, known) => {
    const spec = legacySpec(group, row, known)
    if (used.has(spec.id)) return
    used.add(spec.id)
    // The older collector divided BOGMBASE by 1,000 but labelled it billions.
    // Neither the amount nor the unit can be corrected safely from that snapshot alone.
    const unitUnverified = spec.id === 'FRED:BOGMBASE'
    const note = unitUnverified
      ? '기존 수집기의 본원통화 단위 변환을 검증하지 못해 값을 표시하지 않습니다.'
      : `기존 TM26 수집본${updatedAt ? ` · 수집 ${updatedAt}` : ' · 수집 시각 없음'}. 관측 기간과 수집 시각은 다릅니다. 과거 원시 관측치가 없어 변화량은 표시하지 않습니다.`
    result.push(economySeries(spec, unitUnverified ? [] : [{ date: row.day, value: row.value }], { now, stale, note }))
  }
  for (const known of EXPECTED) {
    // Match by name across groups: newer collection versions split policy/curve/employment.
    const korea = known[0].startsWith('kr_')
    const group = groups.find(g => (g.side === 'KR' || g.key.startsWith('kr_')) === korea && g.rows?.some(r => r.name === known[1]))
    const row = group?.rows?.find(r => r.name === known[1])
    put(group ?? { key: known[0], side: korea ? 'KR' : 'US' }, row ?? { name: known[1] }, known)
  }
  for (const group of groups) for (const row of Array.isArray(group.rows) ? group.rows : []) {
    if (!row?.name || EXPECTED.some(s => s[1] === row.name && s[0].startsWith(group.key.startsWith('kr_') ? 'kr_' : 'us_'))) continue
    put(group, row)
  }
  return result
}

export const NAVER_ECONOMY_SPECS = [
  ['FX_USDKRW','미국 달러 / 원','fx','KOR','KRW/USD'],
  ['FX_EURKRW','유로 / 원','fx','KOR','KRW/EUR'],
  ['FX_JPYKRW','100엔 / 원','fx','KOR','KRW/100 JPY'],
  ['FX_CNYKRW','위안 / 원','fx','KOR','KRW/CNY'],
  ['.DXY','달러인덱스 (ICE)','fx','GLOBAL','지수'],
  ['EURUSD','유로 / 달러','fx','GLOBAL','USD/EUR'],
  ['USDJPY','달러 / 엔','fx','GLOBAL','JPY/USD'],
  ['GBPUSD','파운드 / 달러','fx','GLOBAL','USD/GBP'],
  ['CLcv1','WTI 근월물 선물','commodities','GLOBAL','USD/BBL'],
  ['LCOcv1','브렌트유 근월물 선물','commodities','GLOBAL','USD/BBL'],
  ['GCcv1','금 근월물 선물','commodities','GLOBAL','USD/OZS'],
  ['SIcv1','은 근월물 선물','commodities','GLOBAL','USD/OZS'],
  ['HGcv1','구리 근월물 선물','commodities','GLOBAL','USD/LBS'],
  ['NGcv1','천연가스 근월물 선물','commodities','GLOBAL','USD/MMBTU'],
  ['Ccv1','옥수수 근월물 선물','commodities','GLOBAL','USc/BSH'],
  ['Wcv1','소맥 근월물 선물','commodities','GLOBAL','USc/BSH'],
  ['Scv1','대두 근월물 선물','commodities','GLOBAL','USc/BSH'],
  ['M04020000','KRX 금 현물','commodities','KOR','KRW/g'],
]

const commodityUnitNotes = {
  'USD/BBL': '미국 달러/배럴',
  'USD/OZS': '미국 달러/트로이온스',
  'USD/LBS': '미국 달러/파운드',
  'USD/MMBTU': '미국 달러/백만 BTU',
  'USc/BSH': '미국 센트/부셸(100센트 = 1달러). 달러로 환산하지 않은 제공처 원단위',
  'KRW/g': '원/그램',
}

export function naverEconomySeries(rows, now = Date.now()) {
  return NAVER_ECONOMY_SPECS.map(([code, name, category, country, unit]) => {
    // The majors and category lists overlap. Keep the newest actual observation,
    // rather than depending on request completion order or inventing a history.
    const quote = (Array.isArray(rows) ? rows : []).filter(row => row?.reutersCode === code)
      .sort((a, b) => (Date.parse(observationDate(b.localTradedAt)) || 0) - (Date.parse(observationDate(a.localTradedAt)) || 0))[0]
    // A provider changing dollars to cents (or pounds to tonnes) must not silently
    // change the meaning of a quote. KRX uses the equivalent Korean unit label.
    const unitVerified = category !== 'commodities' || quote?.unit === unit || (unit === 'KRW/g' && quote?.unit === '원/g')
    const price = unitVerified ? economyNumber(quote?.closePrice) : null, rawChange = economyNumber(quote?.fluctuations)
    const direction = String(quote?.fluctuationsType?.code ?? '')
    const delta = rawChange === null ? null : ['4','5'].includes(direction) ? -Math.abs(rawChange) : ['1','2'].includes(direction) ? Math.abs(rawChange) : rawChange
    const source = { name: code.startsWith('FX_') ? '네이버페이 증권 · 하나은행' : '네이버페이 증권', url: quote?.endUrl || 'https://stock.naver.com/market/marketindex' }
    const note = [quote?.delayTime > 0 ? `${quote.delayTime}분 지연` : quote?.priceDataType === 'NOTICE_ROUND' ? '은행 고시환율' : quote?.priceDataType === 'CLOSING_PRICE' ? '일별 마감값' : '출처의 최근 관측값',
      category === 'commodities' && country === 'GLOBAL' ? '현물이 아닌 최근월 선물 가격' : null,
      category === 'commodities' ? commodityUnitNotes[unit] : null,
      category === 'commodities' && quote && !unitVerified ? '제공처 단위를 확인하지 못해 값을 표시하지 않습니다.' : null,
      '현재 관측 1점만 제공하며 전일 날짜나 과거 경로를 추정하지 않습니다.'].filter(Boolean).join(' · ')
    return economySeries({ id: `NAVER:${code}`, name, category, country, unit, frequency: quote?.priceDataType === 'CLOSING_PRICE' ? 'daily' : 'intraday', source },
      [{ date: quote?.localTradedAt, value: price }], { now, previous: price !== null && delta !== null ? price - delta : null, note })
  })
}

export function krTreasurySeries(quote, now = Date.now()) {
  const value = economyNumber(quote?.closePrice), diff = economyNumber(quote?.fluctuations)
  const direction = String(quote?.fluctuationsType?.code ?? '')
  const signed = diff === null ? null : ['4','5'].includes(direction) ? -Math.abs(diff) : ['1','2'].includes(direction) ? Math.abs(diff) : diff
  return economySeries({ id: 'NAVER:KR10YT', name: '한국 국고채 10년', category: 'rates', country: 'KOR', unit: '%', frequency: 'daily', source: { name: '네이버페이 증권', url: 'https://m.stock.naver.com/marketindex/bond/KR10YT%3DRR' } },
    [{ date: quote?.localTradedAt, value }], { now, previous: value !== null && signed !== null ? value - signed : null, note: '금리 차이는 %p입니다. 과거 날짜를 추정하지 않고 현재 관측 1점만 제공합니다.' })
}

export function ecbEconomySeries(body, now = Date.now()) {
  const data = body?.base === 'USD' && body?.amount === 1 ? body.rates : null
  const specs = [
    ['USDKRW','달러 / 원 · ECB 기준','KRW/USD', r => r.KRW],
    ['JPYKRW','100엔 / 원 · ECB 기준','KRW/100 JPY', r => r.JPY > 0 ? r.KRW / r.JPY * 100 : null],
    ['EURKRW','유로 / 원 · ECB 기준','KRW/EUR', r => r.EUR > 0 ? r.KRW / r.EUR : null],
    ['CNYKRW','위안 / 원 · ECB 기준','KRW/CNY', r => r.CNY > 0 ? r.KRW / r.CNY : null],
  ]
  return specs.map(([code, name, unit, derive]) => {
    const points = Object.entries(data ?? {}).flatMap(([date, values]) => {
      const r = Object.fromEntries(['KRW','JPY','EUR','CNY'].map(c => [c, economyNumber(values?.[c])]))
      return r.KRW !== null && r.KRW > 0 ? [{ date, value: derive(r) }] : []
    })
    return economySeries({ id: `ECB:${code}`, name, category: 'fx', country: 'KOR', unit, frequency: 'daily', source: { name: 'ECB · Frankfurter', url: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html' } }, points,
      { now, note: 'ECB 일별 기준환율에서 환산했습니다. 은행 고시환율이나 장중 거래가격과 다를 수 있습니다.' })
  })
}

export const TREASURY_MATURITIES = [
  ['1MO','1 Mo','1개월'],['2MO','2 Mo','2개월'],['3MO','3 Mo','3개월'],['4MO','4 Mo','4개월'],['6MO','6 Mo','6개월'],
  ['1Y','1 Yr','1년'],['2Y','2 Yr','2년'],['3Y','3 Yr','3년'],['5Y','5 Yr','5년'],['7Y','7 Yr','7년'],
  ['10Y','10 Yr','10년'],['20Y','20 Yr','20년'],['30Y','30 Yr','30년'],
]
export const treasuryUrl = year => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`
function csvCells(line) {
  return (line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g) ?? []).filter(Boolean).map(cell => cell.replace(/,$/, '').trim().replace(/^"|"$/g, '').replaceAll('""', '"'))
}
export function treasuryDate(input) {
  const iso = observationDate(input)
  if (iso) return iso.slice(0, 10)
  const match = typeof input === 'string' && input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return match ? observationDate(`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`) : null
}
export function treasuryEconomySeries(csv = '', now = Date.now()) {
  const lines = csv.split(/\r?\n/).filter(line => line.trim()), header = csvCells(lines[0] ?? '')
  const dateIndex = header.findIndex(cell => /^date$/i.test(cell))
  const rows = dateIndex < 0 ? [] : lines.slice(1).map(csvCells)
  const series = TREASURY_MATURITIES.map(([code, title, name]) => {
    const index = header.findIndex(cell => cell.toLowerCase().replaceAll(/\s+/g,' ') === title.toLowerCase())
    const points = index < 0 ? [] : rows.map(row => ({ date: treasuryDate(row[dateIndex]), value: row[index] }))
    return economySeries({ id: `UST:${code}`, name: `미국 국채 ${name}`, category: 'rates', country: 'USA', unit: '%', frequency: 'daily', source: { name: '미국 재무부', url: 'https://home.treasury.gov/resource-center-data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve' } }, points,
      { now, note: '공식 일별 파 수익률(Par Yield). 금리 차이는 %p이며 1%p = 100bp입니다.' })
  })
  for (const [short, suffix, name] of [['2Y','10Y_2Y','10년 − 2년'],['3MO','10Y_3MO','10년 − 3개월']]) {
    const long = series.find(s => s.id === 'UST:10Y'), shorter = new Map(series.find(s => s.id === `UST:${short}`).points.map(p => [p.date,p.value]))
    const points = long.points.filter(p => shorter.has(p.date)).map(p => ({ date: p.date, value: Number((p.value - shorter.get(p.date)).toPrecision(12)) }))
    series.push(economySeries({ id: `UST:${suffix}`, name: `미국 국채 ${name}`, category: 'rates', country: 'USA', unit: '%p', frequency: 'daily', source: long.source }, points,
      { now, note: '미국 재무부의 같은 관측일 금리끼리 뺀 값입니다.' }))
  }
  return series
}

export function treasuryFallback(series, storedBond, pushedSeries, now = Date.now()) {
  const fredIds = { '3MO':'DGS3MO','2Y':'DGS2','10Y':'DGS10','30Y':'DGS30','10Y_2Y':'T10Y2Y','10Y_3MO':'T10Y3M' }
  return series.map(current => {
    if (current.value !== null) return current
    const code = current.id.slice(4)
    const bond = storedBond?.items?.find(row => row.key === `US${code}`)
    const saved = bond && economySeries({ ...current, source: { name: '미국 재무부 · TM26 저장본', url: current.source.url } }, [{ date: treasuryDate(bond.day), value: bond.value }],
      { now, stale: true, note: '공식 직접 요청이 실패하여 기존 저장본을 표시합니다. 최신성을 확인하지 못했습니다.' })
    const legacy = pushedSeries.find(s => s.id === `FRED:${fredIds[code]}` && s.value !== null)
    if (saved?.value !== null && saved?.value !== undefined && (!legacy || Date.parse(saved.asOf) >= Date.parse(legacy.asOf))) return saved
    return legacy ? { ...legacy, id: current.id, name: current.name, status: 'stale', note: '공식 직접 요청이 실패하여 FRED의 기존 수집본을 표시합니다. 최신성을 확인하지 못했습니다.' } : current
  })
}

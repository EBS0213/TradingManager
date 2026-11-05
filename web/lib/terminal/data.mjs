// Values without an observed source stay null. Never substitute simulated prices.
export const REGIONS = ['americas', 'emea', 'asiaPacific']
export const INDICES = [
  ['DOW JONES', '.DJI', 'americas', '다우'], ['S&P 500', '.INX', 'americas', 'S&P500'],
  ['NASDAQ', '.IXIC', 'americas', '나스닥'], ['S&P/TSX Comp', '.GSPTSE', 'americas'],
  ['S&P/BMV IPC', '.MXX', 'americas'], ['IBOVESPA', '.BVSP', 'americas'],
  ['Euro Stoxx 50', '.STOXX50E', 'emea'], ['FTSE 100', '.FTSE', 'emea'],
  ['CAC 40', '.FCHI', 'emea'], ['DAX', '.GDAXI', 'emea'], ['IBEX 35', '.IBEX', 'emea'],
  ['FTSE MIB', '.FTMIB', 'emea'], ['OMX STKH30', '.OMXS30', 'emea'], ['SWISS MKT', '.SSMI', 'emea'],
  ['KOSPI', 'KOSPI', 'asiaPacific', '코스피'], ['KOSDAQ', 'KOSDAQ', 'asiaPacific', '코스닥'],
  ['NIKKEI', '.N225', 'asiaPacific', '닛케이225'], ['HANG SENG', '.HSI', 'asiaPacific'],
  ['SHANGHAI', '.SSEC', 'asiaPacific', '상해종합'], ['TAIWAN', '.TWII', 'asiaPacific', '대만 가권'],
  ['CSI 300', '.CSI300', 'asiaPacific'], ['S&P/ASX 200', '.AXJO', 'asiaPacific'],
]
export function numeric(value) {
  if (value == null || value === '') return null
  const number = Number(String(value).replace(/[,\s%+]/g, ''))
  return Number.isFinite(number) ? number : null
}
export function observedHistory(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map(row => {
    const raw = String(row.localDateTime || '')
    const time = /^\d{14}$/.test(raw)
      ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}+09:00`
      : row.time
    const value = numeric(row.currentPrice ?? row.closePrice ?? row.value)
    return time && Number.isFinite(Date.parse(time)) && value !== null ? {time, value} : null
  }).filter(Boolean).sort((a,b) => Date.parse(a.time)-Date.parse(b.time)).slice(-390)
}
export function observedDailyHistory(rows, quote={}) {
  if (!Array.isArray(rows)) return []
  const tradedDate = /^\d{4}-\d{2}-\d{2}/.exec(quote.time || '')?.[0]
  const closed = ['CLOSE','CLOSED','END'].includes(String(quote.marketStatus))
  const dates = new Map()
  for (const row of rows) {
    const raw = String(row.localDate || row.time || '')
    const time = /^\d{8}$/.test(raw) ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}` : raw
    const value = numeric(row.closePrice ?? row.close ?? row.value)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(time) || !Number.isFinite(Date.parse(time))
        || new Date(time).toISOString().slice(0,10)!==time || value===null || value<=0) continue
    const isComplete = tradedDate ? time < tradedDate || (time===tradedDate && closed) : null
    dates.set(time,{time,value,close:value,open:numeric(row.openPrice ?? row.open),
      high:numeric(row.highPrice ?? row.high),low:numeric(row.lowPrice ?? row.low),
      volume:numeric(row.accumulatedTradingVolume ?? row.volume),isComplete})
  }
  return [...dates.values()].sort((a,b)=>a.time.localeCompare(b.time)).slice(-110)
}
export function marketItem(spec, quote, {status='delayed', asOf=null, history=[]}={}) {
  const [id, code] = spec
  const value = numeric(quote?.price ?? quote?.closePrice)
  let change = numeric(quote?.diff ?? quote?.compareToPreviousClosePrice)
  let pctChange = numeric(quote?.rate ?? quote?.fluctuationsRatio)
  // Naver sometimes sends an unsigned difference and a separate direction code.
  if (['4','5'].includes(String(quote?.compareToPreviousPrice?.code))) {
    if (change !== null) change = -Math.abs(change)
    if (pctChange !== null) pctChange = -Math.abs(pctChange)
  }
  const points = observedHistory(history)
  return {id, code, value, change, pctChange, avat:null, ytd:null, ytdCur:null,
    time:quote?.localTradedAt || quote?.at || '', asOf,
    dataStatus:value === null ? 'unavailable' : status, source:'NAVER Finance',
    history:points, historyGranularity:points.length ? 'minute' : null, sparkline1:points.map(x=>x.value), sparkline2:[],
    lastUpdated:asOf, marketStatus:quote?.marketStatus || quote?.state || quote?.status || null}
}
export function marketSnapshot(items, {lastUpdated=null, errors=[], source='NAVER Finance'}={}) {
  const out = Object.fromEntries(REGIONS.map(region => [region, []]))
  items.forEach((item,i) => out[INDICES[i][2]].push(item))
  const available = items.filter(x => x.value !== null)
  return {...out, source, dataSource:source, status:!available.length ? 'unavailable'
    : available.every(x=>x.dataStatus === 'stale') ? 'stale' : 'delayed',
    lastUpdated, isFromRedis:false, fromRedis:false, errors,
    coverage:{available:available.length,total:items.length},
    note:'공개 시세 조회값입니다. 거래소별 지연·휴장 시간이 다르며 실시간 체결 피드가 아닙니다.'}
}
export function localOverview(question, data) {
  const rows = REGIONS.flatMap(region => data[region] || [])
  const available = rows.filter(x => Number.isFinite(x.value))
  if (!available.length) return '로컬 데이터 요약 · 현재 확인 가능한 시장 시세가 없습니다. 데이터 연결이 회복되면 비교할 수 있습니다. 임의의 시세나 전망은 생성하지 않습니다.'
  const query = String(question || '').toLowerCase()
  const selected = available.filter(x => query.includes(x.id.toLowerCase()) || query.includes(x.code.toLowerCase()))
  const ranked = [...available].filter(x => Number.isFinite(x.pctChange)).sort((a,b)=>b.pctChange-a.pctChange)
  const shown = selected.length ? selected : [ranked[0],ranked.at(-1)].filter((x,i,a)=>x && a.indexOf(x)===i)
  const label = x => `${x.id}: ${x.value.toLocaleString('ko-KR', {maximumFractionDigits:2})}${Number.isFinite(x.pctChange) ? ` (${x.pctChange>=0?'+':''}${x.pctChange.toFixed(2)}%)` : ''}`
  return ['로컬 데이터 요약 (생성형 AI 미사용)',
    `확인 가능한 지수 ${available.length}/${rows.length}개 · 상태 ${data.status} · 조회 ${data.lastUpdated || '시각 미확인'}`,
    ...shown.map(label),
    selected.length ? '선택한 지수의 관측값입니다.' : '관측된 등락률 중 최고·최저를 비교했습니다.',
    '지수별 거래일과 조회 시각이 다를 수 있습니다. 원인·전망·뉴스 해석은 이 수치만으로 판단할 수 없습니다.'].join('\n')
}

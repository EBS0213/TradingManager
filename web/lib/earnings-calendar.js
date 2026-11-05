export function calendarDays(now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  return Array.from({ length: 14 }, (_, i) => {
    const date = new Date(`${today}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + i)
    return date.toISOString().slice(0, 10)
  })
}

export function normalizeEarnings(payload, date) {
  if (!payload?.data || (payload.data.rows !== null && !Array.isArray(payload.data.rows))) {
    throw new Error('일정 응답 형식 오류')
  }
  const seen = new Set()
  return (payload.data.rows || []).filter(row => {
    const symbol = String(row.symbol || '').trim()
    if (!symbol || seen.has(symbol)) return false
    seen.add(symbol)
    return true
  }).map(row => ({
    date, symbol: String(row.symbol).trim(), name: String(row.name || '').trim(),
    time: row.time === 'time-pre-market' ? '장전'
      : row.time === 'time-after-hours' ? '장후' : '시간 미정',
    quarter: String(row.fiscalQuarterEnding || ''),
    marketCap: Number(String(row.marketCap || '').replace(/[^0-9.]/g, '')) || 0,
  })).sort((a, b) => b.marketCap - a.marketCap || a.symbol.localeCompare(b.symbol))
}

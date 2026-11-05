import { calendarDays, normalizeEarnings } from '@/lib/earnings-calendar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

let memo = null
let pending = null

async function load(days) {
  const results = new Map()
  let index = 0
  // Bound upstream concurrency and keep each failed day distinct from an empty day.
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (index < days.length) {
      const date = days[index++]
      try {
        const response = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
          next: { revalidate: 3600 },
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) throw new Error('upstream unavailable')
        results.set(date, { date, ok: true, items: normalizeEarnings(await response.json(), date) })
      } catch {
        results.set(date, { date, ok: false, items: [] })
      }
    }
  }))
  const calendar = days.map(day => results.get(day))
  const value = {
    ok: calendar.some(day => day.ok),
    days: calendar, updatedAt: new Date().toISOString(),
    timeZone: 'America/New_York',
    source: 'https://www.nasdaq.com/market-activity/earnings',
  }
  // Retry partial upstream failures sooner; never present missing data as no events.
  memo = { first: days[0], expires: Date.now() + (calendar.every(day => day.ok) ? 3600000 : 60000), value }
  return value
}

export async function GET() {
  const days = calendarDays()
  if (memo?.first === days[0] && memo.expires > Date.now()) return Response.json(memo.value)
  if (!pending) pending = load(days).finally(() => { pending = null })
  const value = await pending
  return Response.json(value, { status: value.ok ? 200 : 503 })
}

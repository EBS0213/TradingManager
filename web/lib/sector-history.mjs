// Daily aggregates survive frequent reruns without truncating the 30-day window.
export function mergeSectorHistory(...lists) {
  const days = new Map()
  for (const point of lists.flat().filter(p => p && typeof p.stamp === 'string' &&
    Number.isFinite(Date.parse(p.stamp.slice(0,10))) && p.cnt && typeof p.cnt === 'object' &&
    !Array.isArray(p.cnt) && Object.values(p.cnt).every(n => Number.isInteger(n) && n >= 0))
    .sort((a,b) => a.stamp.localeCompare(b.stamp))) {
    const day = point.stamp.slice(0,10), previous = days.get(day)
    if (previous?.basis === 'main' && point.basis !== 'main') continue
    days.set(day, {stamp:point.stamp, cnt:point.cnt, basis:point.basis === 'main' ? 'main' : 'all'})
  }
  const points = [...days.values()]
  if (!points.length) return []
  const cutoff = Date.parse(points.at(-1).stamp.slice(0,10)) - 29 * 86400000
  return points.filter(p => Date.parse(p.stamp.slice(0,10)) >= cutoff)
}

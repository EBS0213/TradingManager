export function bofaResult(result, now = Date.now()) {
  if (result?.value === null) return null
  if (typeof result?.value !== 'number' || !Number.isFinite(result.value) || result.value < 0 || result.value > 10)
    throw new Error('BofA 값은 0~10 숫자 또는 null이어야 합니다')
  const prev = result.prev ?? null
  if (prev !== null && (typeof prev !== 'number' || !Number.isFinite(prev) || prev < 0 || prev > 10))
    throw new Error('직전값이 올바르지 않습니다')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date || '')) throw new Error('발표 기준일이 필요합니다')
  const at = Date.parse(result.date + 'T00:00:00Z')
  if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== result.date || at > now || now - at > 14 * 86400000)
    throw new Error('BofA 기준일이 미래이거나 14일보다 오래됐습니다')
  const url = new URL(result.source)
  if (!['https:', 'http:'].includes(url.protocol) || !result.title?.trim()) throw new Error('출처 URL과 제목이 필요합니다')
  return { value: result.value, prev, at: new Date(at).toISOString(), source: url.href,
    title: result.title.slice(0, 500), by: 'local-codex', checkedAt: new Date(now).toISOString() }
}

export function briefText(result) {
  const text = typeof result?.text === 'string' ? result.text.trim() : ''
  if (text.length < 400 || text.length > 40000) throw new Error('브리핑 본문 길이가 올바르지 않습니다')
  if (/<\s*(script|iframe|object)\b|\bon\w+\s*=/i.test(text)) throw new Error('허용하지 않는 HTML입니다')
  return text
}

export const RESEARCH_STANDARD = 'kirs-2026-10-27'
export const RESEARCH_STANDARD_MARKER = '<meta name="tm26-research-standard" content="kirs-2026-10-27">'

export function reportMetadata(body, filenames = []) {
  const dates = filenames.flatMap(filename => {
    const match = String(filename).match(/(20\d{2})[._-](\d{2})[._-](\d{2})/)
    if (!match) return []
    const value = match.slice(1).join('-')
    const parsed = new Date(value + 'T00:00:00Z')
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? [value] : []
  }).sort()
  return {
    report_date: dates.at(-1) || null,
    report_standard: String(body || '').includes(RESEARCH_STANDARD_MARKER) ? RESEARCH_STANDARD : 'legacy',
  }
}

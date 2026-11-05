// ============================================================
//  뉴스 모으기 (RSS)
//  · 각 언론사가 공개한 RSS 만 읽습니다.
//  · 제목과 원문 링크만 씁니다. 본문은 가져오지도, 보여주지도 않습니다
//    (저작권 때문입니다 — 읽고 싶으면 원문으로 보냅니다).
//  · 언론사마다 주소가 바뀌는 일이 잦아, 후보 주소를 여러 개 두고
//    되는 것을 씁니다. 어느 것이 됐는지는 응답의 feeds 에 남습니다.
// ============================================================

export const FEEDS = [
  { name: '연합뉴스', urls: ['https://www.yna.co.kr/rss/economy.xml'] },
  { name: '매일경제', urls: ['https://www.mk.co.kr/rss/50200011/'] },
  { name: '뉴시스', urls: [
    'https://www.newsis.com/RSS/economy.xml',
    'https://newsis.com/RSS/economy.xml',
  ] },
  // 뉴스1 · 한국경제는 여기서 부르지 않습니다.
  //  2026-08-17 확인: 두 곳 모두 해외 데이터센터에서 오는 요청을 403 으로 막습니다.
  //  이 사이트는 미국 서버(Vercel)에서 돌기 때문에 몇 번을 불러도 403 입니다.
  //  대신 서울에 있는 AWS 서버가 받아서 /api/news/push 로 보내 줍니다
  //  (tools/push_news.py). 여기 다시 넣으면 실패 기록만 쌓입니다.
]

const strip = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim()

const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? strip(m[1]) : ''
}

/** 주소 하나를 읽어 기사 목록으로 */
async function one(url, name, timeoutMs = 7000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, {
      cache: 'no-store', signal: ac.signal,
      headers: {
        // 일부 언론사는 기본 요청을 막습니다. 평범한 브라우저처럼 요청합니다.
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
          + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const xml = await r.text()
    const items = xml.split(/<item[\s>]/i).slice(1)
    const out = items.map((b) => {
      const when = pick(b, 'pubDate') || pick(b, 'dc:date')
      const ms = when ? new Date(when).getTime() : NaN
      return {
        source: name,
        title: pick(b, 'title'),
        url: pick(b, 'link'),
        ms: isNaN(ms) ? null : ms,
      }
    }).filter((x) => x.title && x.url)
    if (!out.length) throw new Error('기사가 없습니다')
    return out
  } finally {
    clearTimeout(t)
  }
}

/** 여러 곳을 한꺼번에. 한 곳이 죽어도 나머지는 보여줍니다. */
export async function fetchNews({ max = 40 } = {}) {
  const errors = []
  const feeds = []

  const lists = await Promise.all(FEEDS.map(async (f) => {
    const tried = []
    for (const url of f.urls) {
      try {
        const rows = await one(url, f.name)
        feeds.push({ name: f.name, ok: true, url, count: rows.length })
        return rows
      } catch (e) {
        tried.push(`${url} → ${e?.message || e}`)
      }
    }
    feeds.push({ name: f.name, ok: false, tried })
    errors.push(`${f.name}: ${tried[tried.length - 1] || '실패'}`)
    return []
  }))

  const seen = new Set()
  const items = []
  for (const x of lists.flat()) {
    const k = x.title.replace(/\s/g, '')
    if (seen.has(k)) continue          // 같은 기사 중복 제거
    seen.add(k)
    items.push(x)
  }
  items.sort((a, b) => (b.ms || 0) - (a.ms || 0))
  return { items: items.slice(0, max), errors, feeds }
}

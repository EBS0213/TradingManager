// ============================================================
//  BofA 불&베어 지표 값을 주간 기사에서 뽑아냅니다.
//
//  왜 이렇게까지 하나
//   이 지표는 BofA 가 기관 고객용 주간 리포트(The Flow Show)에만 싣고
//   공개 API 가 없습니다. 언론이 인용 보도할 때 숫자가 함께 나옵니다.
//   그래서 기사를 읽어 숫자만 건져 옵니다.
//
//  두 단계로 시도합니다
//   ① 구글 뉴스 RSS 제목·요약에 정규식      — 공짜, 대부분 여기서 잡힙니다
//   ② 그래도 없으면 Claude 에게 웹 검색시킴 — 조용한 주에 대비한 보험
//
//  못 구한 주는 억지로 채우지 않습니다. 마지막 값과 날짜를 그대로 두고
//  화면이 '며칠 전 값' 이라고 밝히게 합니다. 오래된 숫자를 최신인 척
//  보여주는 것이 제일 나쁩니다.
// ============================================================
import { enqueueAI } from '@/lib/local-ai'

const UA = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  accept: 'application/rss+xml, application/xml, text/xml, */*',
}

const FEEDS = [
  'https://news.google.com/rss/search?q=%22Bull%20%26%20Bear%20Indicator%22&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=%EB%B6%88+%EC%95%A4+%EB%B2%A0%EC%96%B4+%EC%A7%80%ED%91%9C+BofA&hl=ko&gl=KR&ceid=KR:ko',
]

const strip = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim()

/* 값은 0~10 입니다. 그 밖의 숫자가 잡히면 버립니다
   (기사에는 VIX·수익률·연도 같은 숫자가 잔뜩 섞여 있습니다). */
const sane = (v) => (Number.isFinite(v) && v >= 0 && v <= 10 ? v : null)

/**
 * 기사 한 토막에서 값을 뽑습니다.
 *
 * 숫자 고르는 규칙이 까다로워서 순서를 정해 두었습니다. 기사에는
 * 값 말고도 임계값(8.0)·연도(2021)·'out of 10' 같은 숫자가 섞여 있습니다.
 *
 *  ① "from 9.4 to reach 9.7" · "9.5에서 9.6으로"  → 뒤가 현재값, 앞이 직전값
 *  ② 그 밖에는 지표 이름 뒤에 처음 나오는 소수    → "jumped to 9.7 ... threshold 8.0"
 *     에서 8.0(임계값)이 아니라 9.7 을 집기 위함입니다
 *  ③ 소수가 하나도 없으면 포기합니다. 정수만 있는 문장은
 *     'out of 10' 같은 말일 때가 많아 잘못 집기 쉽습니다.
 */
const DEC = /\d{1,2}\.\d/
const DEC_G = /\d{1,2}\.\d/g
const ANCHORS = [
  /Bull\s*&(?:amp;)?\s*Bear\s+(?:sentiment\s+)?[Ii]ndicator/g,
  /불\s*앤[드]?\s*베어\s*지[표수]/g,
  /불앤베어\s*지[표수]/g,
]

function fromWindow(win) {
  // ① 옮겨간 값
  const en = win.match(/from\s+(\d{1,2}\.\d)\s+to\s+(?:reach\s+)?(\d{1,2}\.\d)/i)
  if (en) return { value: sane(+en[2]), prev: sane(+en[1]) }
  const ko = win.match(/(\d{1,2}\.\d)\s*에서\s*(\d{1,2}\.\d)/)
  if (ko) return { value: sane(+ko[2]), prev: sane(+ko[1]) }
  return null
}

export function extract(text) {
  const t = String(text || '')
  for (const re of ANCHORS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(t)) !== null) {
      const after = t.slice(re.lastIndex, re.lastIndex + 120)
      const before = t.slice(Math.max(0, m.index - 100), m.index)

      const moved = fromWindow(after) || fromWindow(before)
      if (moved && moved.value != null) return moved

      // ② 지표 이름 뒤에 처음 나오는 소수
      const a = after.match(DEC)
      if (a && sane(+a[0]) != null) return { value: sane(+a[0]), prev: null }
      // 이름이 문장 끝에 있으면 앞쪽에서 마지막 소수를 봅니다
      const b = before.match(DEC_G)
      if (b && b.length) {
        const v = sane(+b[b.length - 1])
        if (v != null) return { value: v, prev: b.length > 1 ? sane(+b[b.length - 2]) : null }
      }
    }
  }
  return null
}


async function readFeed(url) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 9000)
  try {
    const r = await fetch(url, { headers: UA, cache: 'no-store', signal: ac.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const xml = await r.text()
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 25).map(m => {
      const b = m[1]
      const one = (tag) => {
        const x = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
        return x ? strip(x[1]) : ''
      }
      return { title: one('title'), desc: one('description'), link: one('link'),
               date: one('pubDate') }
    })
  } finally { clearTimeout(t) }
}

/** 기사에서 찾아봅니다. 못 찾으면 null. */
export async function findFromNews() {
  const items = []
  for (const f of FEEDS) {
    try { items.push(...await readFeed(f)) } catch { /* 한 곳이 막혀도 계속 */ }
  }
  for (const it of items) {
    const hit = extract(`${it.title} ${it.desc}`)
    if (hit) return { ...hit, title: it.title, source: it.link, by: 'auto-rss' }
  }
  return null
}

/** RSS에 없으면 맥미니가 웹 원문을 확인한다. API 키는 사용하지 않는다. */
export async function findFromAI() {
  const day = new Date().toISOString().slice(0, 10)
  const job = await enqueueAI('bofa', { requestedDay: day }, `bofa:${day}`)
  return { queued: true, job }
}

export async function findBofa() {
  return (await findFromNews()) || (await findFromAI())
}

// ============================================================
//  텔레그램 공개 채널 읽기
//
//  공개 채널은 t.me/s/채널이름 이라는 '미리보기' 웹페이지를 열어 둡니다.
//  로그인도 봇도 필요 없이, 그냥 공개된 웹페이지를 읽는 것입니다.
//  (준의 개인 계정으로 로그인해 긁는 방식은 텔레그램 약관 위반이라 쓰지 않습니다.)
//
//  글은 통째로 옮기지 않습니다. 첫 줄(요지)과 원문 링크까지만 씁니다 —
//  뉴스와 같은 원칙입니다. 채널 글 상당수가 해외 기사를 옮긴 2차 저작물이라
//  더 조심해야 합니다.
// ============================================================

/** 읽어 올 채널.
 *  kind 는 브리핑에서 어느 절에 쓸지 가늠하는 꼬리표입니다.
 *   해외  = 밤사이 해외 · 글로벌 동향
 *   국내  = 국내 종목·업종
 *  max 는 그 채널에서 몇 건까지 가져올지 (자주 올리는 곳은 더 많이). */
export const TG_CHANNELS = [
  // 지표 발표를 '실제 vs 예상 vs 이전' 으로 실시간 중계합니다. 영어입니다.
  // 밤사이 해외 절의 알맹이가 여기서 나옵니다. 짧은 글이 많아 넉넉히 가져옵니다.
  { id: 'livesquaw', name: 'Live Squawk', kind: '해외', lang: 'en', max: 30 },
  /* 블룸버그 단독·속보를 가장 빨리 옮기는 채널입니다 (2026-08-27 추가, Jun 요청).
     영어이고 한 줄짜리 헤드라인이 대부분이라 넉넉히 가져옵니다.
     ⚠️ 여기 올라오는 글은 **검증 전 속보**입니다. 브리핑에는 '채널발' 꼬리표가
        붙어 나가고, 글쓰기 지시문이 '제목에서 확인되지 않는 내용은 쓰지 말 것'
        을 못박고 있습니다. */
  { id: 'WalterBloomberg', name: 'Walter Bloomberg', kind: '해외', lang: 'en', max: 25 },
  // 미국 개별종목·수급·내부자 거래
  { id: 'insidertracking', name: '미국주식 인사이더', kind: '해외', max: 18 },
  // 2026-08-24: pcstfu 는 미리보기(t.me/s/…)를 닫아 두어 브리핑 로그에
  //  매번 '미리보기가 열려 있지 않습니다' 만 쌓였습니다 — 한 건도 못 받았습니다.
  //  같은 이름으로 미리보기가 열려 있는 hyperspect 로 바꿉니다
  //  (머리글 실시간 피드가 쓰는 채널과 같은 곳입니다).
  { id: 'hyperspect', name: '해외정보 분석', kind: '해외', max: 14 },
  { id: 'KimchiTerminal', name: '김치터미널', kind: '해외', max: 14 },
  // 일반 속보 채널이라 사건·사고가 많습니다. 경제·시장 글만 걸러 씁니다.
  { id: 'news_kor', name: '실시간 속보', kind: '국내', econOnly: true, max: 12 },
]

/* 경제·시장과 관련된 글만 남기는 그물 */
const ECON = new RegExp([
  '증시|주가|코스피|코스닥|나스닥|다우|S&P',
  '금리|환율|물가|인플레|고용|실업|GDP|경기',
  '수출|수입|무역|관세|통상',
  '반도체|배터리|이차전지|조선|방산|바이오|자동차|철강|화학|원전',
  '실적|영업이익|매출|어닝|공시|상장|IPO|공모',
  '유가|원유|금값|구리|천연가스',
  '연준|FOMC|한국은행|금통위|기재부|정부.*대책',
  '삼성전자|SK하이닉스|현대차|LG|포스코|한화',
].join('|'), 'i')

/* 채널 글 안에 원 출처가 적혀 있는 경우가 많습니다 (블룸버그·로이터·골드만 등).
   브리핑에서 "어디서 나온 말인지" 를 밝히려고 뽑아 둡니다.
   적혀 있지 않으면 비워 둡니다 — 없는 출처를 지어내면 안 되기 때문입니다. */
const OUTLETS = [
  ['블룸버그', /블룸버그|Bloomberg/i],
  ['로이터', /로이터|Reuters/i],
  ['FT', /파이낸셜\s?타임스|Financial Times|(^|[^A-Za-z])FT([^A-Za-z]|$)/],
  ['WSJ', /월스트리트\s?저널|Wall Street Journal|WSJ/i],
  ['CNBC', /CNBC/i],
  ['뉴욕타임스', /뉴욕\s?타임스|New York Times|NYT/i],
  ['AP통신', /AP\s?통신|Associated Press/i],
  ['니혼게이자이', /니혼게이자이|닛케이\s?신문|Nikkei/i],
  ['SCMP', /사우스차이나|SCMP/i],
  ['가디언', /가디언|The Guardian/i],
  ['악시오스', /악시오스|Axios/i],
  ['배런스', /배런스|Barron/i],
  ['CNN', /CNN/],
  ['폴리티코', /폴리티코|Politico/i],
  ['골드만삭스', /골드만\s?삭스|Goldman/i],
  ['모건스탠리', /모건\s?스탠리|Morgan Stanley/i],
  ['JP모건', /JP\s?모건|JPMorgan|J\.P\. ?Morgan/i],
  ['씨티', /씨티\s?그룹|Citigroup|Citi(?![a-z])/i],
  ['바클레이즈', /바클레이|Barclays/i],
  ['UBS', /(^|[^A-Za-z])UBS([^A-Za-z]|$)/],
  ['뱅크오브아메리카', /뱅크오브아메리카|BofA|Bank of America/i],
  ['도이체방크', /도이체|Deutsche Bank/i],
  ['노무라', /노무라|Nomura/i],
]

function findOutlets(text) {
  const t = String(text || '')
  const hit = []
  for (const [name, re] of OUTLETS) {
    if (re.test(t) && !hit.includes(name)) hit.push(name)
    if (hit.length >= 2) break
  }
  return hit
}

const UA = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
}

/* &#036; 같은 숫자 기호까지 사람 글자로 되돌립니다.
   2026-08-21: 예전에는 이름 있는 기호(&lt; &gt; &amp; 등)만 풀었습니다.
    그래서 채널 글의 "NZ&#036;19억" 이 브리핑에 그대로 &#036; 로 찍혔습니다
    (&#036; 은 달러표시 $ 입니다). &amp; 를 마지막에 푸는 것이 순서상 중요합니다. */
function unent(t) {
  return String(t)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
      const n = parseInt(h, 16)
      return Number.isFinite(n) && n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m
    })
    .replace(/&#(\d+);/g, (m, d) => {
      const n = Number(d)
      return Number.isFinite(n) && n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m
    })
    .replace(/&amp;/g, '&')
}

/* 태그를 걷어내고 사람이 읽는 글로 */
function toText(html) {
  let t = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  t = unent(t)
  // 두 번 감싸인 경우(&amp;#036;)까지 풀어 줍니다
  if (/&#\d+;|&#x[0-9a-fA-F]+;/.test(t)) t = unent(t)
  return t
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 채널 하나 읽기.
 * @returns [{ channel, name, id, no, url, title, body, ms }]
 */
export async function fetchTgChannel(ch, { timeoutMs = 8000 } = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let html = ''
  try {
    const r = await fetch(`https://t.me/s/${encodeURIComponent(ch.id)}`, {
      headers: UA, cache: 'no-store', signal: ac.signal,
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    html = await r.text()
  } finally {
    clearTimeout(timer)
  }
  if (!/tgme_widget_message/.test(html))
    throw new Error('미리보기가 열려 있지 않습니다')

  const out = []
  // 글 하나가 data-post="채널/번호" 로 시작합니다
  const parts = html.split('data-post="').slice(1)
  for (const part of parts) {
    const post = part.slice(0, part.indexOf('"'))
    const no = Number(String(post).split('/')[1])
    if (!Number.isFinite(no)) continue

    // 본문
    const key = 'js-message_text'
    const at = part.indexOf(key)
    let body = ''
    if (at >= 0) {
      const open = part.indexOf('>', at)
      const close = part.indexOf('</div>', open)
      if (open > 0 && close > open) body = toText(part.slice(open + 1, close))
    }
    if (!body) continue

    // 올린 시각
    let ms = null
    const dm = part.match(/datetime="([^"]+)"/)
    if (dm) {
      const t = new Date(dm[1]).getTime()
      if (Number.isFinite(t)) ms = t
    }

    // 요지로 쓸 첫 줄. 링크만 있는 줄은 건너뜁니다 —
    //  2026-08-21: 브리핑에 "[미국주식 인사이더] https://n.news.naver.com/..." 처럼
    //  주소만 덩그러니 실리는 일이 있었습니다.
    const isLink = (l) => /^https?:\/\/\S+$/.test(l.trim())
    const lines = body.split('\n').filter((l) => l.trim().length > 1)
    const first = lines.find((l) => !isLink(l)) || lines[0] || body
    out.push({
      channel: ch.id, name: ch.name, kind: ch.kind,
      no, url: `https://t.me/${ch.id}/${no}`,
      title: first.slice(0, 140).trim(),
      // 본문도 함께 넘깁니다. 첫 줄만 보면 "홍콩 개인정보 62% 급증" 처럼
      // 제목만 남고 알맹이(숫자·배경)가 통째로 버려집니다.
      //  · 이 본문은 글 쓰는 재료로만 씁니다. 사이트에 그대로 싣지 않습니다.
      //  · 브리핑에는 우리 문장으로 다시 쓴 요지와 원문 링크만 나갑니다.
      body: body.slice(0, 900),
      // 글 안에 적힌 원 출처 (없으면 빈 배열)
      outlets: findOutlets(body),
      chars: body.length,
      ms,
    })
  }
  // 페이지에는 오래된 글이 위에 있습니다. 최신이 앞으로 오게 뒤집습니다.
  return out.reverse()
}

/**
 * 여러 채널을 한꺼번에. 한 곳이 죽어도 나머지는 씁니다.
 * @param sinceMs 이 시각 이후 글만 (없으면 전부)
 */
export async function fetchTgFeeds({ sinceMs = null, perChannel = 12, channels = TG_CHANNELS } = {}) {
  const errors = []
  const lists = await Promise.all(channels.map(async (ch) => {
    try {
      let rows = await fetchTgChannel(ch)
      if (sinceMs) rows = rows.filter((x) => x.ms == null || x.ms >= sinceMs)
      if (ch.econOnly) rows = rows.filter((x) => ECON.test(x.title))
      return rows.slice(0, ch.max || perChannel)
    } catch (e) {
      errors.push(`${ch.name}(@${ch.id}): ${e?.message || e}`)
      return []
    }
  }))

  // 채널끼리 같은 소식을 옮기는 일이 잦습니다 (해외 기사 번역이라 특히).
  // 앞 24글자가 같으면 같은 소식으로 봅니다.
  const seen = new Set()
  const items = []
  for (const x of lists.flat().sort((a, b) => (b.ms || 0) - (a.ms || 0))) {
    const k = x.title.replace(/\s/g, '').slice(0, 24)
    if (k.length >= 8 && seen.has(k)) continue
    seen.add(k)
    items.push(x)
  }
  return { items, errors }
}

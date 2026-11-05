// ============================================================
//  네이버 금융에서 시장 지수·순위를 가져옵니다.
//  · 화면이 열릴 때마다 긁지 않고 60초 동안 저장해 둔 값을 씁니다.
//  · 한 곳이 실패해도 나머지는 그대로 보여줍니다 (부분 실패 허용).
// ============================================================
const UA = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Referer': 'https://finance.naver.com/',
  'Accept-Language': 'ko-KR,ko;q=0.9',
}

// 네이버는 쪽마다 글자 방식(EUC-KR / UTF-8)이 다릅니다.
// 그래서 둘 다 풀어 보고 깨진 글자가 적은 쪽을 씁니다.
async function getText(url) {
  const r = await fetch(url, { headers: UA, cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const bad = (s) => (s.match(/�/g) || []).length
  let utf = ''; let euc = ''
  try { utf = new TextDecoder('utf-8').decode(buf) } catch { /* 무시 */ }
  try { euc = new TextDecoder('euc-kr').decode(buf) } catch { /* 무시 */ }
  if (!euc) return utf
  if (!utf) return euc
  return bad(utf) <= bad(euc) ? utf : euc
}

/* ETF·ETN·스팩·우선주는 순위에서 뺍니다 (파이썬 스크리너와 같은 기준) */
const ETFISH = /(^|\s)(KODEX|TIGER|KBSTAR|ARIRANG|HANARO|SOL|ACE|PLUS|RISE|TIMEFOLIO|WOORI|KIWOOM|HK|마이다스|파워|FOCUS|BNK|VITA|TREX|1Q)\b|ETN|레버리지|인버스|리츠/
const SPAC = /스팩|기업인수목적/
const PREF = /우[BC]?$|(\d)우$/
export function isPlainStock(name) {
  const n = String(name || '').trim()
  if (!n) return false
  return !ETFISH.test(n) && !SPAC.test(n) && !PREF.test(n)
}
async function getJson(url) {
  const r = await fetch(url, { headers: UA, cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

const num = (v) => {
  if (v == null) return null
  const n = parseFloat(String(v).replace(/[,\s%+]/g, ''))
  return Number.isFinite(n) ? n : null
}
const strip = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim()

/* ── 지수 (코스피 · 코스닥) ───────────────────────────────── */
export async function fetchIndex(code) {
  // m.stock 쪽 JSON 이 가장 안정적입니다
  const b = await getJson(`https://m.stock.naver.com/api/index/${code}/basic`)
  const price = num(b.closePrice)
  const diff = num(b.compareToPreviousClosePrice)
  const rate = num(b.fluctuationsRatio)
  return {
    code,
    name: code === 'KOSPI' ? '코스피' : '코스닥',
    price, diff, rate,
    prevClose: (price != null && diff != null) ? price - diff : null,
    high: num(b.highPrice), low: num(b.lowPrice), open: num(b.openPrice),
    volume: num(b.accumulatedTradingVolume),
    value: num(b.accumulatedTradingValue),
    state: b.marketStatus || b.stockExchangeType || null,
    at: b.localTradedAt || b.tradeStopYn || null,
  }
}

/* ── 장중 1분 흐름. 못 받으면 최근 일봉으로 대체합니다 ──── */
export async function fetchIndexSeries(code) {
  try {
    // [{"localDateTime":"20260811090000","currentPrice":6229.27, ...}, ...]
    const j = await getJson(
      `https://api.stock.naver.com/chart/domestic/index/${code}/minute`)
    if (Array.isArray(j) && j.length) {
      const pts = j.map((p) => {
        const s = String(p.localDateTime || '')
        return { t: s.length >= 12 ? `${s.slice(8, 10)}:${s.slice(10, 12)}` : '',
          v: num(p.currentPrice ?? p.closePrice) }
      }).filter((p) => p.v != null)
      if (pts.length) return { kind: 'intraday', points: pts }
    }
  } catch { /* 아래 일봉으로 */ }

  // 대체 — 최근 일봉 종가
  const j = await getJson(
    `https://api.stock.naver.com/chart/domestic/index/${code}?periodType=dayCandle&count=1`)
  const arr = Array.isArray(j?.priceInfos) ? j.priceInfos : []
  const pts = arr.slice(-60).map((p) => {
    const s = String(p.localDate || '')
    return { t: s.length >= 8 ? `${s.slice(4, 6)}/${s.slice(6, 8)}` : '', v: num(p.closePrice) }
  }).filter((p) => p.v != null)
  return { kind: 'daily', points: pts }
}

/* ── 투자자별 수급 · 등락 종목 수 · 거래량 · 거래대금 ─────
   HTML 을 긁지 않고 네이버가 그대로 내려주는 JSON 을 씁니다.
   (예전에 글자를 뒤져서 숫자를 고르다 보니 엉뚱한 값이 잡혔습니다) */
export async function fetchMarketDetail(code) {
  const j = await getJson(`https://m.stock.naver.com/api/index/${code}/integration`)
  const out = { flow: {}, updown: {} }

  const d = j?.dealTrendInfo || {}
  out.flow['개인'] = num(d.personalValue)        // 단위: 억원
  out.flow['외국인'] = num(d.foreignValue)
  out.flow['기관'] = num(d.institutionalValue)

  const u = j?.upDownStockInfo || {}
  out.updown = {
    up: num(u.riseCount), flat: num(u.steadyCount), down: num(u.fallCount),
    upper: num(u.upperCount), lower: num(u.lowerCount),
  }

  // 총정보 표 — 거래량은 '천주', 거래대금은 '백만' 단위로 옵니다
  const info = {}
  for (const t of (j?.totalInfos || [])) info[t.code] = String(t.value ?? '')
  const vol = num(info.accumulatedTradingVolume)
  const val = num(info.accumulatedTradingValue)
  out.volume = vol == null ? null : vol * 1000
  out.value = val == null ? null : val * 1e6
  out.open = num(info.openPrice); out.high = num(info.highPrice); out.low = num(info.lowPrice)
  out.high52 = num(info.highPriceOf52Weeks); out.low52 = num(info.lowPriceOf52Weeks)
  return out
}

/* ── 시가총액 표 (여기서 거래량·거래대금 순위도 만듭니다) ──

   2026-09-21 에 바꿨습니다. 예전에는
       finance.naver.com/sise/sise_market_sum.naver
   의 표를 긁었는데, 네이버가 이 쪽을 stock.naver.com 으로 옮기면서
   302 로 넘어가게 됐습니다. 넘어간 곳은 자바스크립트로 그리는 화면이라
   HTML 에 표도 /item/main.naver?code= 링크도 없습니다. 그래서 한 줄도
   못 읽어 **히트맵과 종목·업종 순위가 통째로 비었습니다.**
   (같은 이사가 스크리너 쪽에서 먼저 터진 것이 screener/sources.py 건입니다)

   이제는 그 화면이 쓰는 JSON 을 그대로 받습니다. 기본 차례가 시가총액
   내림차순이라 page 1,2,3 이 곧 상위 300종목입니다.
     https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=1&pageSize=100
   단위 — marketValue 는 억원(화면이 /10000 해서 '조' 로 씁니다),
          accumulatedTradingValue 는 백만원이라 1e6 을 곱해 원으로 맞춥니다.   */
const MKT_NAME = (sosok) => (sosok === 0 ? 'KOSPI' : 'KOSDAQ')

export async function fetchMarketSum(sosok, pages = 2) {
  const market = MKT_NAME(sosok)
  const rows = []
  const seen = new Set()
  for (let p = 1; p <= pages; p++) {
    const d = await getJson(
      `https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${p}&pageSize=100`)
    const list = Array.isArray(d?.stocks) ? d.stocks : []
    if (!list.length) break
    for (const x of list) {
      const code = String(x?.itemCode || '').trim()
      if (!/^\d{6}$/.test(code) || seen.has(code)) continue
      // ETF·ETN 은 이름 규칙이 아니라 종류로 걸러집니다 (브랜드를 좇지 않아도 됩니다)
      if (x?.stockEndType && x.stockEndType !== 'stock') continue
      const price = num(x?.closePrice)
      if (price == null) continue
      seen.add(code)
      const volume = num(x?.accumulatedTradingVolume)
      const value = num(x?.accumulatedTradingValue)        // 백만원
      rows.push({
        code,
        name: String(x?.stockName || '').trim(),
        market,
        price,
        rate: num(x?.fluctuationsRatio),                   // 부호가 그대로 옵니다
        marcap: num(x?.marketValue),                       // 억원
        volume,
        amount: value != null ? value * 1e6
          : (volume != null ? price * volume : null),      // 원
      })
    }
    if (list.length < 100) break
  }
  return rows
}

/* ── 인기 검색 종목 ──────────────────────────────────────── */
export async function fetchPopular() {
  const html = await getText('https://finance.naver.com/sise/lastsearch2.naver')
  const body = html.split('<tbody>')[1] || html
  const out = []
  for (const tr of body.split('<tr')) {
    const code = tr.match(/\/item\/main\.naver\?code=(\d{6})/)
    if (!code) continue
    const nameM = tr.match(/\/item\/main\.naver\?code=\d{6}"[^>]*>([^<]+)</)
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]))
    if (tds.length < 5) continue
    out.push({
      code: code[1], name: (nameM ? nameM[1] : '').trim(),
      price: num(tds[3]), rate: num(tds[5]),
    })
    if (out.length >= 10) break
  }
  return out
}

/* ── 종목별 뉴스 ─────────────────────────────────────────
   2026-08-23 추가 — 검색 상세의 [관련 뉴스] 칸이 씁니다.

   네이버 모바일 금융의 종목 뉴스 창구를 씁니다(JSON).
   ⚠️ **응답 모양을 확신할 수 없습니다.** 그래서 열쇠 이름을 하나하나 지정하지 않고,
   받은 JSON 을 통째로 훑어 **제목처럼 생긴 값과 기사 번호가 같이 있는 덩어리**를
   찾아냅니다. 네이버가 겉모양을 바꿔도 잘 버티고, 못 찾으면 빈 배열을 돌려주어
   부르는 쪽이 대비책(전체 뉴스에서 회사 이름으로 걸러내기)을 쓰게 합니다.

   링크는 officeId(언론사) + articleId(기사) 로 만듭니다 — 네이버 뉴스 주소 규칙입니다. */
/* 기사 대표 그림 (2026-09-13) — 검색 상세의 뉴스 목록이 야후처럼
   썸네일을 붙이면서 넣었습니다.
   ⚠️ 네이버가 어느 이름으로 주는지는 **보장이 없습니다**. 그래서 그럴듯한 이름을
   여러 개 훑고, 못 찾으면 그냥 비웁니다 — 화면은 그림 없이도 제대로 나옵니다
   (매체 첫 글자를 넣은 회색 네모가 대신 들어갑니다).
   추가로 기사 본문을 따로 받아 og:image 를 캐는 방법도 있지만, 한 종목에
   스무 번을 더 부르게 되어 넣지 않았습니다. */
const IMG_KEYS = ['imageOriginLink', 'imageUrl', 'thumbnail', 'thumbnailUrl',
                  'thumbUrl', 'imgUrl', 'image', 'photo', 'photoUrl']
function pickImage(x) {
  for (const k of IMG_KEYS) {
    let v = x[k]
    if (v && typeof v === 'object') v = v.url || v.src || v.origin || ''
    v = String(v || '').trim()
    if (!v) continue
    if (v.startsWith('//')) v = 'https:' + v
    if (/^https?:\/\//.test(v)) return v.replace(/^http:/, 'https:')
  }
  return ''
}

export async function fetchStockNews(code, max = 20) {
  const url = `https://m.stock.naver.com/api/news/stock/${encodeURIComponent(code)}`
    + `?pageSize=${Math.min(30, max * 2)}&page=1`
  const j = await getJson(url)

  const out = []
  const seen = new Set()
  const walk = (x) => {
    if (!x || out.length >= max) return
    if (Array.isArray(x)) { x.forEach(walk); return }
    if (typeof x !== 'object') return

    const title = x.title || x.articleTitle || x.subject
    const office = x.officeId || x.officeid || x.oid
    const article = x.articleId || x.articleid || x.aid
    if (title && office && article) {
      const key = String(title).replace(/\s/g, '')
      if (!seen.has(key)) {
        seen.add(key)
        const dt = String(x.datetime || x.dateTime || x.date || '')      // 20260823093000
        out.push({
          title: String(title).replace(/<[^>]*>/g, '').trim(),
          url: `https://n.news.naver.com/mnews/article/${office}/${article}`,
          source: String(x.officeName || x.officename || '').trim(),
          day: /^\d{8}/.test(dt) ? dt.slice(0, 8) : '',
          time: /^\d{12}/.test(dt) ? `${dt.slice(8, 10)}:${dt.slice(10, 12)}` : '',
          image: pickImage(x),
        })
      }
    }
    for (const v of Object.values(x)) walk(v)
  }
  walk(j)
  return out.slice(0, max)
}

/* ── 상승률 상위 ─────────────────────────────────────────
   2026-08-23 추가 — 홈 화면의 '인기 검색' 자리를 '상승률' 로 바꾸면서 넣었습니다.

   ⚠️ **열 번호를 고정하지 않았습니다.** 네이버가 표 모양을 조금만 바꿔도
   `tds[3]`, `tds[5]` 같은 자리 지정은 통째로 어긋납니다(그러면 화면에 엉뚱한
   숫자가 조용히 찍힙니다). 그래서 여기서는
     · 등락률 = **'%' 가 들어 있는 첫 칸**
     · 현재가 = **'%' 가 없고 숫자로만 된 첫 칸**
   으로 찾습니다. 자리가 바뀌어도 뜻으로 찾으니 잘 버팁니다.
   그래도 못 읽으면 빈 배열을 돌려주고, 부르는 쪽에서 대비책을 씁니다. */
export async function fetchRise(sosok = 0, max = 60) {
  /* 2026-09-21 — sise_rise.naver 도 같이 죽어(302) 표를 못 읽었습니다.
     'errors' 에 "상승률: 네이버 표를 못 읽어 시가총액 표에서 대신 뽑았습니다"
     가 찍히던 것이 이것입니다. 상승률 전용 JSON 으로 바꿉니다. */
  const market = MKT_NAME(sosok)
  /* 이 목록은 ETF·ETN 이 태반입니다(한 쪽 100개 중 보통주는 30여 개).
     그래서 원하는 수를 채울 때까지 쪽을 넘깁니다. */
  const out = []
  for (let p = 1; p <= 4 && out.length < max; p++) {
    const d = await getJson(
      `https://m.stock.naver.com/api/stocks/up/${market}?page=${p}&pageSize=100`)
    const list = Array.isArray(d?.stocks) ? d.stocks : []
    if (!list.length) break
    for (const x of list) {
      const code = String(x?.itemCode || '').trim()
      if (!/^\d{6}$/.test(code)) continue
      if (x?.stockEndType && x.stockEndType !== 'stock') continue
      const rate = num(x?.fluctuationsRatio)
      const price = num(x?.closePrice)
      if (price == null && rate == null) continue
      out.push({ code, name: String(x?.stockName || '').trim(), market, price, rate })
      if (out.length >= max) break
    }
    if (list.length < 100) break
  }
  return out
}

/* ── 이웃 지수 (미국 · 중국 · 대만 · 일본) ────────────────
   2026-08-11 확인: `https://api.stock.naver.com/index/{코드}/basic` 이 동작합니다.
   미국 지수는 코드를 확실히 확인하지 못해 후보를 차례로 시도합니다.
   장이 열려 있는지는 네이버가 주는 marketStatus 를 그대로 씁니다. */
const WORLD = [
  { name: 'S&P500', codes: ['.INX', '.SPX', 'SPI@SPX'] },
  { name: '나스닥', codes: ['.IXIC', 'NAS@IXIC'] },
  { name: '다우', codes: ['.DJI', '.INDU'] },
  { name: 'VIX', codes: ['.VIX'] },
  { name: '상해종합', codes: ['.SSEC'] },
  { name: '대만 가권', codes: ['.TWII'] },
  { name: '닛케이225', codes: ['.N225'] },
]

export async function fetchWorld() {
  const list = []
  const tried = []
  for (const w of WORLD) {
    let got = null
    for (const code of w.codes) {
      const url = `https://api.stock.naver.com/index/${code}/basic`
      try {
        const j = await getJson(url)
        const price = num(j.closePrice ?? j.currentPrice)
        const rate = num(j.fluctuationsRatio)
        if (price == null || rate == null) { tried.push(`형식다름 ${w.name} ${code}`); continue }
        got = {
          name: w.name, code, price, rate,
          diff: num(j.compareToPreviousClosePrice),
          open: /open/i.test(String(j.marketStatus || '')),
          status: String(j.marketStatus || ''),
        }
        break
      } catch (e) {
        tried.push(`실패 ${w.name} ${code} (${e?.message || e})`)
      }
    }
    if (got) list.push(got)
  }
  return { list, tried }
}

/* ─────────────────────────────────────────────────────────────
   일봉 · 주봉 (검색 화면 큰 차트에서만 씁니다)
   네이버 시세 JSON 은 홑따옴표를 쓰는 준(準)JSON 이라 손질해서 읽습니다.
   ───────────────────────────────────────────────────────────── */
const SISE = 'https://api.finance.naver.com/siseJson.naver'

function ymdPlain(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
}

/**
 * @param code 6자리 종목코드
 * @param tf   'day' | 'week' | 'month'
 * @param bars 받아올 봉 개수(대략)
 */
export async function fetchOhlcv(code, tf = 'day', bars = 120) {
  const now = new Date(Date.now() + 9 * 3600 * 1000)
  // 달력으로 며칠을 거슬러 갈까 — 주봉은 7일, 월봉은 31일에 봉 하나 (2026-10-03 월봉 추가)
  const back = tf === 'month' ? bars * 31 + 40
    : tf === 'week' ? bars * 7 + 30 : Math.round(bars * 1.6) + 20
  const from = new Date(now.getTime() - back * 86400000)
  const url = `${SISE}?symbol=${encodeURIComponent(code)}&requestType=1`
    + `&startTime=${ymdPlain(from)}&endTime=${ymdPlain(now)}&timeframe=${tf}`

  // 2026-08-24: 시간 제한을 걸었습니다.
  //  전에는 없었습니다. 네이버가 어쩌다 응답을 안 주면 이 함수가 그대로 매달려
  //  Vercel 의 30초 한도까지 갔고, 그러면 브라우저는 JSON 이 아닌 오류 쪽지를
  //  받아 "시세를 받지 못했습니다" 만 띄웠습니다. 무엇이 잘못됐는지 알 길이
  //  없는 고장이었습니다. 12초에 끊고 **까닭을 적어** 돌려줍니다.
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 12000)
  let r
  try {
    r = await fetch(url, {
      cache: 'no-store',
      signal: ac.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
          + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        referer: 'https://finance.naver.com/',
      },
    })
  } catch (e) {
    throw new Error(e?.name === 'AbortError'
      ? '네이버가 12초 안에 답하지 않았습니다' : `네이버에 닿지 못했습니다 (${e?.message || e})`)
  } finally { clearTimeout(timer) }
  if (!r.ok) throw new Error(`네이버 응답 HTTP ${r.status}`)
  const text = await r.text()

  let arr
  try {
    arr = JSON.parse(text.replace(/'/g, '"').replace(/,\s*\]/g, ']'))
  } catch {
    throw new Error('시세 형식을 읽지 못했습니다')
  }
  if (!Array.isArray(arr) || arr.length < 2) throw new Error('시세가 비어 있습니다')

  const rows = []
  for (const x of arr.slice(1)) {
    if (!Array.isArray(x) || x.length < 5) continue
    const [d, o, h, l, c, v] = x
    const day = String(d)
    if (!/^\d{8}$/.test(day)) continue
    const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : null)
    if (num(c) == null) continue
    rows.push({ d: day, o: num(o), h: num(h), l: num(l), c: num(c), v: num(v) })
  }
  return rows.slice(-bars)
}

/* ─────────────────────────────────────────────────────────────
   미국 종목 긴 주봉 · 월봉 (2026-10-03)
   Massive 무료 등급은 2년치뿐이라, 몇 년짜리 차트는 네이버 해외 차트에서 받습니다.
   네이버는 나스닥 종목에 '.O' 를 붙이고 뉴욕증권거래소 종목은 티커 그대로입니다
   (AAPL.O · JPM). 우리 쪽에는 거래소 정보가 없어서 **둘 다 물어보고 합칩니다**.
   거래소를 옮긴 종목(MXL — 2021년 NYSE → 나스닥)은 그래야 옛 자료까지 이어집니다.
   다만 티커만 같은 다른 회사가 붙지 않도록, 이어지는 자리의 종가가 크게 다르면
   옛 쪽은 버립니다.
   · 네이버 주봉 날짜는 그 주 **일요일**입니다 — 우리 규칙(그 주 마지막 거래일)에 맞춰
     금요일로 옮깁니다. 아직 안 온 금요일이면 오늘로 둡니다.
   ───────────────────────────────────────────────────────────── */
const NAVER_FOREIGN = 'https://api.stock.naver.com/chart/foreign/item'

async function fetchForeign(sym, tf, from, to) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 12000)
  try {
    const r = await fetch(`${NAVER_FOREIGN}/${encodeURIComponent(sym)}/${tf}`
      + `?startDateTime=${from}0000&endDateTime=${to}0000`,
      { cache: 'no-store', signal: ac.signal, headers: UA })
    if (!r.ok) return []
    const j = await r.json().catch(() => null)
    if (!Array.isArray(j)) return []
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
    return j.map((x) => ({
      d: String(x.localDate), o: n(x.openPrice), h: n(x.highPrice),
      l: n(x.lowPrice), c: n(x.closePrice), v: n(x.accumulatedTradingVolume),
    })).filter((x) => /^\d{8}$/.test(x.d) && x.c != null)
  } catch { return [] } finally { clearTimeout(timer) }
}

export async function fetchUsLong(sym, tf = 'week', years = 20) {
  const now = new Date()
  const to = ymdPlain(now)
  const from = ymdPlain(new Date(now.getTime() - years * 366 * 86400000))
  const [nas, nyse] = await Promise.all([
    fetchForeign(`${sym}.O`, tf, from, to),
    fetchForeign(sym, tf, from, to),
  ])
  // 최근 자료가 있는 쪽을 본줄기로, 다른 쪽은 그보다 옛날 것만 앞에 잇습니다
  const lastD = (a) => (a.length ? a[a.length - 1].d : '')
  let [main, old] = lastD(nas) >= lastD(nyse) ? [nas, nyse] : [nyse, nas]
  if (!main.length) throw new Error('네이버 해외 차트에 자료가 없습니다')
  const head = old.filter((x) => x.d < main[0].d)
  if (head.length) {
    const ratio = head[head.length - 1].c / main[0].c
    if (!(ratio > 0.6 && ratio < 1.6)) head.length = 0      // 다른 회사일 수 있습니다
  }
  let rows = head.concat(main)
  if (tf === 'week') {
    rows = rows.map((x) => {
      const d = new Date(Date.UTC(+x.d.slice(0, 4), +x.d.slice(4, 6) - 1, +x.d.slice(6, 8)))
      if (d.getUTCDay() !== 0) return x
      d.setUTCDate(d.getUTCDate() + 5)
      const fri = ymdPlain(d)
      return { ...x, d: fri > to ? to : fri }
    })
  }
  return rows
}

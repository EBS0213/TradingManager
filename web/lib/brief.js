// ============================================================
//  마감 브리핑 만들기 — 텔레그램으로 보낼 글을 조립합니다.
//  2026-10-12 부터는 「한국시장 셋업」·「미국시장 셋업」 한 줄 — 종목 카드 앨범의 설명으로 붙습니다
// ============================================================
const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/* 억 단위 */
function eok(v) {
  if (v == null) return '-'
  const e = v / 1e8
  return `${e > 0 ? '+' : ''}${Math.round(e).toLocaleString('ko-KR')}억`
}

/** 오늘 날짜 (한국 시간) */
export function todayKst() {
  const k = new Date(Date.now() + 9 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return {
    day: `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`,
    label: `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 `
      + `(${['일', '월', '화', '수', '목', '금', '토'][k.getUTCDay()]})`,
    dow: k.getUTCDay(),
  }
}

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(90000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// 사이트의 '셋업 있음' 목록에서 셋업 품질 상위 다섯만 보냅니다 (2026-10-12).
// 예전 종합점수·피벗상태·거래대금 필터는 적용하지 않습니다.
export const BRIEF_N = 5

export function pickCandidates(rows, n = BRIEF_N) {
  return rows
    .filter((r) => r.state === 'setup' && r.sq?.total != null
      && Number.isFinite(Number(r.sq.total)))
    .slice()
    .sort((a, b) => Number(b.sq.total) - Number(a.sq.total)
      || String(a.code).localeCompare(String(b.code)))
    .slice(0, n)
    .map((r) => ({
      code: String(r.code), name: String(r.name || r.code), sector: r.sector,
      rs: r.rs, price: r.price, chg: r.chg, pivot: r.pivot, gap: r.gap,
      stop: r.stop, score: Number(r.sq.total), stage: '셋업 있음',
      su: { pivot: r.pivot, stop: r.stop, baseStart: r.baseStart },
    }))
}

/** 업종별 RS 중앙값 */
const SECTOR_MIN = 5           // 이보다 적은 업종은 중앙값이 우연에 좌우됩니다
const SECTOR_SKIP = /^(-|기타|기타금융|지주|투자회사)$/   // '-' 는 업종을 못 붙인 종목

export function sectorRS(rows, n = 5) {
  const by = new Map()
  for (const r of rows) {
    const s = String(r['업종'] ?? '')
    const rs = num(r['RS'])
    if (!s || rs == null || SECTOR_SKIP.test(s)) continue
    if (!by.has(s)) by.set(s, [])
    by.get(s).push({ rs, pass: r['판정'] === '통과' })
  }
  const med = (a) => {
    const x = a.slice().sort((p, q) => p - q)
    const m = x.length >> 1
    return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2
  }
  return [...by.entries()]
    .filter(([, v]) => v.length >= SECTOR_MIN)
    .map(([name, v]) => ({
      name, n: v.length,
      rs: med(v.map((x) => x.rs)),
      pass: v.filter((x) => x.pass).length,
    }))
    .sort((a, b) => b.rs - a.rs)
    .slice(0, n)
}

/** 셋업 앨범 제목 — 설명 첫 줄과 카드 머리띠가 같이 씁니다 (2026-10-12 Jun 지정) */
export const setupTitle = (mkt) => (mkt === 'US' ? '미국시장 셋업' : '한국시장 셋업')

/** 텔레그램에 보낼 글 한 통. mkt 는 'KR' 또는 'US'. */
export async function buildBrief(origin, mkt = 'KR') {
  return (await buildBriefParts(origin, mkt)).text
}

/** 글과 함께 **고른 종목**도 돌려줍니다 — 뒤따르는 종목 카드가 같은 목록을 쓰도록 (2026-10-04). */
export async function buildBriefParts(origin, mkt = 'KR') {
  let cands = []
  // 2026-10-12 Jun 지정 — 제목(「TM2026 한국/미국 마감 브리핑 · 날짜」)·지수·채권을 뺐습니다.
  //  앨범 설명에는 「한국시장 셋업」·「미국시장 셋업」 한 줄만 둡니다. 종목 정보는 카드 머리띠에 있습니다.
  const lines = [`<b>■ ${setupTitle(mkt)}</b>`]

  // 사이트의 셋업 판정과 같은 자료를 씁니다. 실패 시 옛 후보로 대체하지 않습니다.
  const setups = await getJson(`${origin}/api/setup?market=${mkt}`)
  if (!setups.ok || setups.market !== mkt || !Array.isArray(setups.rows))
    throw new Error(setups.error || '셋업 판정 결과를 받지 못했습니다.')
  if (setups.failed > 0)
    throw new Error(`셋업 판정 ${setups.failed}종목 누락으로 상위 순위를 확정할 수 없습니다.`)
  const rows = setups.rows

  cands = pickCandidates(rows)
  // 셋업 종목이 없는 날은 그 사실 자체가 정보입니다 — 글로만 나갑니다
  if (!cands.length)
    lines.push(rows.length || setups.stamp ? '오늘은 셋업이 있는 종목이 없습니다.'
                                           : '<i>스크리너 결과가 아직 올라오지 않았습니다.</i>')

  return { text: lines.join('\n'), cands }
}

/** 텔레그램으로 보내기 */
export async function sendTelegram(text, {signal} = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) throw new Error('TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID 가 없습니다.')
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true,
    }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.ok) throw new Error(`텔레그램 실패: ${j.description || r.status}`)
  return j
}

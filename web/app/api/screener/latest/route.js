// ============================================================
//  최신 스크리닝 결과 — 로그인 없이 누구나 볼 수 있습니다.
//  (워치리스트는 로그인한 사람에게만 함께 내려줍니다)
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { getSql } from '@/lib/db'
import { ensureMarketColumn } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* 같은 결과를 매번 2MB 씩 다시 꺼내 해석하지 않도록 풀어 둔 것을 기억합니다 (2026-10-07).
   Vercel 이 CPU 한도에 가깝다고 알려 왔습니다. 결과가 바뀌면(stamp 가 다르면) 새로 읽습니다.
   서버 인스턴스가 바뀌면 비어 있으니 그때만 한 번 더 읽습니다. */
const MEMO = new Map()      // market → { stamp, result }

export async function GET(request) {
  const sql = await getSql()
  const u = await currentUser()

  /* ?market=US — 미국 결과.
     2026-09-01 (Jun 결정) — **로그인 없이도 봅니다.**
       전에는 관리자에게만 내려줬습니다. 미국 주가 자료가 무료 등급의
       '개인 사용' 조건이던 때의 빗장인데, 그 뒤 유료 등급으로 올렸습니다
       (히트맵은 2026-08-20 에 이미 모두에게 열었습니다).
     ⚠️ 되돌리려면 아래 두 줄의 주석을 풀면 됩니다. */
  const want = String(new URL(request.url).searchParams.get('market') || 'KR').toUpperCase()
  const market = want === 'US' ? 'US' : 'KR'
  const symbol = String(new URL(request.url).searchParams.get('symbol') || '').trim().toUpperCase()
  if (symbol && !(market === 'KR' ? /^[0-9][0-9A-Z]{5}$/.test(symbol) : /^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol)))
    return NextResponse.json({ ok: false, error: '종목코드 형식이 올바르지 않습니다.' }, { status: 400 })
  // if (market === 'US' && !(u && u.role === 'admin'))
  //   return NextResponse.json({ ok: false, error: '미국 자료는 관리자만 볼 수 있습니다' },
  //     { status: 403 })

  try { await ensureMarketColumn(sql) } catch { /* 이미 있으면 그만 */ }
  //  먼저 가장 최근 결과의 stamp 만 봅니다. 기억해 둔 것과 같으면 2MB 를 다시 읽지 않습니다.
  const head = await sql`
    SELECT stamp FROM screener_snapshot
    WHERE market = ${market} ORDER BY created_at DESC LIMIT 1`
  if (!head.length)
    return NextResponse.json(symbol ? { ok: true, market, symbol, row: null, stamp: null } : { ok: true, market, result: [], watchlist: [], stamp: null })
  let result = []
  let snap
  const memo = MEMO.get(market)
  if (memo && memo.stamp === head[0].stamp) {
    snap = [{ stamp: memo.stamp }]
    result = memo.result
  } else {
    snap = await sql`
      SELECT stamp, payload FROM screener_snapshot
      WHERE market = ${market} ORDER BY created_at DESC LIMIT 1`
    try { result = JSON.parse(snap[0].payload) } catch { result = [] }
    MEMO.set(market, { stamp: snap[0].stamp, result })
  }

  // The equity monitor needs one score, not the several-megabyte screening universe.
  if (symbol) {
    const found = result.find(row => String(row['코드'] || '').toUpperCase() === symbol)
    const fields = ['코드', '종목명', '시장', '종합점수', '등급', '감점', '감점사유', '점수내역',
      '통과개수', '제외사유', '부적합사유', '판정', 'RS', '편입상태', '잔류일', '실적판정',
      'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']
    const row = found ? Object.fromEntries(fields.map(field => [field, found[field] ?? null])) : null
    return NextResponse.json({ ok: true, market, symbol, row, stamp: snap[0].stamp },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=120' } })
  }

  let watchlist = []

  // 요약 숫자는 로그인 여부와 상관없이 보여줍니다.
  //  (종목별 점수는 가리더라도 "90점 이상이 몇 개인지" 는 누구나 볼 수 있어야
  //   사이트가 무엇을 하는 곳인지 알 수 있습니다)
  const num = (v) => {
    const n = Number(String(v ?? '').replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }
  // 통계는 **스크리너 대상만** 셉니다 (2026-08-26).
  //  제외 = 판정조차 안 한 것(ETF·스팩·우선주)
  //  부적합 = 판정은 했지만 지금 사고팔기 어려운 것(저가주·거래대금 부족·상장 1년 미만)
  //  부적합 종목이 목록에 새로 들어왔다고 '오늘 통과 3종목' 이 갑자기 늘면 안 됩니다.
  const main = result.filter((r) => !r['제외사유'] && !r['부적합사유'])
  const score = (r) => { const n = num(r['종합점수']); return n == null ? -1 : Math.round(n) }
  const passed8 = main.filter((r) => r['판정'] === '통과').length
  // 점수 경계는 화면(app.html)의 SC_TOP·SC_GOOD 과 **같은 값**이어야 합니다.
  //  예전에는 여기만 90·80 이라, 화면이 '85점 이상' 이라 써 놓고 실제로는
  //  90점 이상 개수를 보여주는 일이 있었습니다. 한쪽만 고치지 말 것.
  //  2026-08-30 배점 개편으로 85/75 → 80/70 (app.html · rules.py 등급과 같은 자리)
  const SC_TOP = 80
  const SC_GOOD = 70
  const summary = {
    rows: main.length,
    passed: passed8,
    newIn: main.filter((r) => r['편입상태'] === 'NEW' && r['판정'] === '통과').length,
    sc: { top: SC_TOP, good: SC_GOOD },
    s90: main.filter((r) => score(r) >= SC_TOP).length,
    s80: main.filter((r) => score(r) >= SC_GOOD).length,
    heat: main.length ? Number((passed8 / main.length * 100).toFixed(1)) : 0,
  }

  /* 2026-08-27 — **손님에게도 전부 보냅니다.**
     전에는 여기서 종합점수·피벗·손절가·수급·EPS·매출 같은 칸을 통째로 빼고
     보냈습니다(HIDE 목록). 화면에서 흐리게 가리는 것만으로는 개발자도구로 다
     보이니 아예 담지 말자는 뜻이었습니다.

     이제 스크리너는 누구나 봅니다 (Jun 결정). 스크리닝 결과 자체가 이 사이트가
     보여 주려는 것이고, 가려 두면 무엇이 좋은지 알 수가 없습니다.
     ⚠️ 화면 쪽 canSeeDetail() 과 **짝입니다.** 한쪽만 되돌리면
        "화면은 보여 주려는데 값이 안 오는" 빈칸이 생깁니다 — 되돌릴 때는 둘 다.

     로그인이 필요한 것은 개인 기록뿐입니다. 워치리스트는 아래에서 로그인한
     사람에게만 실어 보냅니다. */

  if (u) {
    const r = await sql`SELECT data FROM screener_user_data WHERE user_id = ${u.id}`
    const w = r[0]?.data?.watchlist
    if (Array.isArray(w)) watchlist = w
  }
  /* 직전 스크리너의 업종별 통과 종목 수 — 화면이 막대 옆에 증감을 적는 데 씁니다.
     결과 전체를 두 벌 읽지 않도록, 업로드할 때 세어 둔 작은 표만 꺼내 옵니다
     (app/api/screener/upload/route.js 의 sector_hist_* 참고).
     이 기능을 넣기 전에 올라온 결과에는 표가 없습니다 — 그때는 아무것도 안 적습니다. */
  let sectorPrev = null; let sectorPrevStamp = null   // summary 에 실어 보냅니다
  let sectorHist = null                              // 추이 선그림용 (전체 목록)
  let histBasis = null                               // 'main' 이면 화면과 같은 기준
  const HKEY = `sector_hist_${market}`
  try {
    const h = await sql`SELECT value FROM screener_settings WHERE key = ${HKEY}`
    let list = Array.isArray(h[0]?.value?.list) ? h[0].value.list : []

    /* 2026-10-04 — 업종 기록의 기준을 화면에 맞춥니다(트레이딩 부적합 제외, basis:'main').
       옛 기록은 부적합을 포함해 세어 화면 막대와 증감이 어긋났습니다. 원본 결과가 남아 있는
       회차(최근 5회)는 여기서 한 번 다시 세어 고쳐 적습니다. 원본이 없는 더 옛 기록은 그대로 둡니다.
       원본 목록(stamp)만 먼저 읽고, 고칠 것이 있을 때만 결과 전체를 엽니다. */
    const mainCnt = (rows) => {
      const c = {}
      for (const r of rows) {
        if (r['제외사유'] || r['부적합사유'] || r['판정'] !== '통과') continue
        const k = String(r['업종'] || '-'); c[k] = (c[k] || 0) + 1
      }
      return c
    }
    {
      const have = await sql`SELECT stamp FROM screener_snapshot WHERE market = ${market}`
      const fix = have.map((x) => x.stamp)
        .filter((st) => !list.some((e) => e && e.stamp?.slice(0,10) === st.slice(0,10) && e.stamp >= st && e.basis === 'main'))
      if (fix.length) {
        const got = await sql`SELECT stamp, payload FROM screener_snapshot
                              WHERE market = ${market} AND stamp = ANY(${fix})`
        for (const g of got) {
          try {
            const cnt = mainCnt(JSON.parse(g.payload))
            list = [...list.filter(x => x && x.stamp !== g.stamp), {stamp:g.stamp,cnt,basis:'main'}]
          } catch { /* 그대로 둡니다 */ }
        }
        try {
          const v = JSON.stringify({ list })
          await sql`INSERT INTO screener_settings (key,value,updated_at) VALUES (${HKEY},${v}::jsonb,now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
        } catch { /* 못 적어도 이번 응답은 나갑니다 */ }
      }
    }
    list.sort((a,b) => String(a?.stamp).localeCompare(String(b?.stamp)))
    let before = list.filter((x) => x && x.stamp && x.stamp < snap[0].stamp)

    /* 아직 옛 기록이 없으면 **한 번만** 직전 결과를 열어 세어 둡니다 (2026-08-23).
       이 기능을 넣기 전에 올라온 결과에는 업종 표가 없습니다. 그것 때문에
       "스크리너를 두 번 돌려야 증감이 보인다" 가 되면 불편합니다.
       결과 전체(2MB)를 읽는 비싼 길이지만 **처음 한 번뿐**입니다 — 세고 나서
       바로 표에 적어 두므로 다음부터는 이 자리로 안 옵니다. */
    if (!before.length) {
      const old = await sql`
        SELECT stamp, payload FROM screener_snapshot
        WHERE market = ${market} AND stamp < ${snap[0].stamp}
        ORDER BY created_at DESC LIMIT 1`
      if (old.length) {
        let rowsOld = []
        try { rowsOld = JSON.parse(old[0].payload) } catch { rowsOld = [] }
        const cnt = mainCnt(rowsOld)
        if (Object.keys(cnt).length) {
          list = [...list.filter((x) => x && x.stamp !== old[0].stamp),
                  { stamp: old[0].stamp, cnt, basis: 'main' }]
            .sort((a, b) => String(a.stamp).localeCompare(String(b.stamp))).slice(-200)
          before = list.filter((x) => x && x.stamp && x.stamp < snap[0].stamp)
          try {
            const v = JSON.stringify({ list })
            await sql`
              INSERT INTO screener_settings (key, value, updated_at)
              VALUES (${HKEY}, ${v}::jsonb, now())
              ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
          } catch { /* 못 적어도 이번 응답은 나갑니다 */ }
        }
      }
    }

    /* 지금 결과까지 포함해서 선그림에 넘깁니다 (마지막 점이 오늘).
       2026-09-01 (Jun 요청) — **최근 30일 · 하루 한 점**.
         전에는 스크리너 10회분을 그대로 그렸습니다. 하루 네 번 도니 사흘치라,
         '추이' 라고 부르기 민망했습니다. 그렇다고 30일 × 4회 = 120점을 다 그리면
         선이 뭉개지고 하루 안의 오르내림이 추세처럼 보입니다.
         **그날 마지막 스크리너**만 남겨 하루 한 점으로 줄입니다 —
         장 마감 뒤 값이라 그날을 대표하기에도 맞습니다. */
    //  새 기준(basis:'main') 기록이 이틀 이상이면 그것만 그립니다. 그 전에는 옛 기준으로 그리고
    //  화면에 '부적합 포함 기준' 이라고 밝힙니다 (summary.sectorHistBasis).
    /* 2026-10-10 (Jun 신고) — '최근 10일' 만 나오던 것을 고쳤습니다.
       새 기준(basis:'main', 10/4 도입) 기록이 이틀 넘게 쌓이자 **새 기준만** 그리게 되어 있어서,
       서버에 남아 있는 9월 기록이 통째로 빠졌습니다. 달로 끊긴 것처럼 보였던 까닭입니다.
       이제 **최근 30일(달력 기준, 마지막 스크리너 날부터 거꾸로)** 을 기준과 상관없이 하루 한 점씩 보냅니다.
       같은 날 두 기준이 다 있으면 새 기준을 씁니다. 점마다 기준을 실어 보내 화면이 옛 기준 구간을 점선으로 그립니다. */
    const ok = (x) => x && x.stamp && x.cnt && typeof x.cnt === 'object'
    const lastDay = String(snap[0].stamp).slice(0, 10)
    const from = new Date(new Date(lastDay + 'T00:00:00Z').getTime() - 29 * 86400000).toISOString().slice(0, 10)
    const byDay = new Map()
    for (const x of list.filter((x) => ok(x) && String(x.stamp).slice(0, 10) >= from)
                        .sort((a, b) => String(a.stamp).localeCompare(String(b.stamp)))) {
      const d = String(x.stamp).slice(0, 10)
      const had = byDay.get(d)
      // 같은 날이면 뒤엣것(그날 마지막 스크리너)이 남되, 새 기준을 옛 기준으로 덮지는 않습니다
      if (had && had.basis === 'main' && x.basis !== 'main') continue
      byDay.set(d, x)
    }
    sectorHist = [...byDay.values()]
      .map((x) => ({ stamp: x.stamp, cnt: x.cnt, basis: x.basis === 'main' ? 'main' : 'all' }))
    const kinds = new Set(sectorHist.map((x) => x.basis))
    histBasis = kinds.size > 1 ? 'mixed' : kinds.has('main') ? 'main' : 'all'

    //  증감은 **같은 기준**끼리만 냅니다. 직전 기록이 옛 기준이면 괄호를 달지 않습니다.
    const sameBasis = before.filter((x) => x && x.basis === 'main')
    const prev = sameBasis.length ? sameBasis[sameBasis.length - 1] : null
    if (prev && prev.cnt && typeof prev.cnt === 'object') {
      sectorPrev = prev.cnt; sectorPrevStamp = prev.stamp
    }
  } catch { /* 없으면 증감을 안 적습니다 */ }

  summary.sectorPrev = sectorPrev
  summary.sectorPrevStamp = sectorPrevStamp
  summary.sectorHistBasis = histBasis
  /* 업종별 통과 종목 **추이 선그림**에 쓸 옛 기록 (2026-08-29, Jun 요청).
     위에서 이미 읽어 둔 같은 표입니다 — Neon 을 한 번 더 오가지 않습니다.
     최근 30일의 일별 집계를 제공합니다. */
  summary.sectorHist = sectorHist

  const base = {
    ok: true, market, stamp: snap[0].stamp, watchlist, summary,
    signedIn: Boolean(u), admin: Boolean(u && u.role === 'admin'),
  }

  // ?fmt=2 — 열이름 접기. 화면(app.html 의 unpackCols)이 펼칩니다.
  //  화면은 예전부터 ?fmt=2 를 붙여 부르고 있었는데 **서버에 이 처리가
  //  없었습니다.** 그래서 늘 펼친 모양으로 나갔습니다.
  //  fmt 를 안 붙이면 예전 모양 그대로 나갑니다 — 옛 화면이 브라우저에
  //  남아 있어도 안전합니다.
  const fmt = String(new URL(request.url).searchParams.get('fmt') || '')
  if (fmt === '2') {
    const packed = packRows(result)
    return NextResponse.json({ ...base, cols: packed.cols, rows: packed.rows })
  }
  return NextResponse.json({ ...base, result })
}

/* 줄마다 되풀이되던 한글 열이름을 맨 위에 한 번만 적습니다.
 *
 *   전  [{"종목명":"삼성전자","RS":88,...}, {"종목명":"SK하이닉스",...}]
 *   후  cols: ["종목명","RS",...]
 *       rows: [["삼성전자",88,...], ["SK하이닉스",...]]
 *
 * 열이 50개 남짓이라 한 줄에 이름표만 700바이트쯤 됩니다.
 * 3,000줄이면 그것만 2MB 가까이 되고, 그만큼 Neon 전송량을 씁니다
 * (2026-08-24 에 전송량 한도가 차서 사이트가 멈춘 적이 있습니다).
 *
 * 열 순서는 **실제로 나온 열 전부**를 모아서 정합니다. 미리 정해 두면
 * 나중에 파이썬이 열을 하나 늘렸을 때 그 값이 조용히 사라집니다.
 * 없는 값은 null 로 채우고, 화면이 펼칠 때 다시 없애 줍니다.
 */
function packRows(rows) {
  const cols = []
  const seen = new Set()
  for (const r of rows) {
    for (const k in r) {
      if (!seen.has(k)) { seen.add(k); cols.push(k) }
    }
  }
  const out = new Array(rows.length)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const a = new Array(cols.length)
    for (let j = 0; j < cols.length; j++) {
      const v = r[cols[j]]
      a[j] = (v === undefined) ? null : v
    }
    out[i] = a
  }
  return { cols, rows: out }
}

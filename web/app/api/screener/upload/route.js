// ============================================================
//  스크리닝 결과 받기  (AWS 서버 → 여기로 POST)
//  로그인이 아니라 비밀 키(SCREENER_KEY)로 확인합니다.
// ============================================================
import { NextResponse } from 'next/server'
import zlib from 'node:zlib'
import { getSql } from '@/lib/db'
import { ensureSettings, ensureMarketColumn } from '@/lib/settings'

export const runtime = 'nodejs'
export const maxDuration = 60

function keyOk(request) {
  const key = request.headers.get('x-screener-key') || ''
  return Boolean(process.env.SCREENER_KEY) && key === process.env.SCREENER_KEY
}

export async function POST(request) {
  if (!keyOk(request)) {
    return NextResponse.json({ ok: false, error: '키가 올바르지 않습니다.' }, { status: 401 })
  }

  // 전송량을 줄이려고 gzip 으로 압축해 보내옵니다. 압축이면 먼저 풉니다.
  let body
  try {
    const raw = Buffer.from(await request.arrayBuffer())
    const enc = (request.headers.get('content-encoding') || '').toLowerCase()
    const text = enc.includes('gzip') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8')
    body = JSON.parse(text)
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: '본문을 읽지 못했습니다: ' + (e?.message || e) }, { status: 400 })
  }

  const rows = Array.isArray(body?.result) ? body.result : null
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'result 가 비어 있습니다.' }, { status: 400 })
  }

  const stamp = String(body.stamp || new Date().toISOString().slice(0, 16).replace('T', ' '))
  // 어느 시장의 결과인가 — 한국(KR)과 미국(US)을 따로 보관합니다.
  //  섞어 두면 미국 결과가 올라올 때마다 한국 결과가 밀려나 사라집니다.
  const market = String(body.market || 'KR').toUpperCase() === 'US' ? 'US' : 'KR'
  // 제외 종목(검색 안내용)은 '검사한 종목' 수에서 뺍니다
  const main = rows.filter((r) => !r['제외사유'])
  const passed = main.filter((r) => r['판정'] === '통과').length
  const payload = JSON.stringify(rows)

  const sql = await getSql()
  await ensureMarketColumn(sql)
  await sql`
    INSERT INTO screener_snapshot (stamp, source, rows, passed, payload, market)
    VALUES (${stamp}, ${String(body.source || 'aws')}, ${main.length}, ${passed},
            ${payload}, ${market})`

  /* 오래된 기록은 시장마다 **5개**만 남깁니다 (한 시장이 다른 시장을 밀어내지 않게).

     2026-08-24 에 30 → 5 로 줄였습니다. 그날 Neon 저장공간이 꽉 차서
     쓰기가 막혔고, 로그인·게시판·스크리닝 결과가 한꺼번에 죽었습니다.
     읽기만 하는 곳은 멀쩡해서 원인을 찾는 데 한참 걸렸습니다.

     왜 30 이 필요 없었나
       결과 한 벌이 2~3MB 입니다. 두 시장 30개면 그것만으로 150MB 가 넘습니다.
       그런데 옛 결과를 쓰는 곳은 '직전 스크리너 대비 업종별 증감' 하나뿐이고,
       그건 **직전 것 하나**면 됩니다. 나머지 29개는 자리만 차지했습니다.
       5개면 하루치가 조금 넘어 되짚어 볼 여유까지 있습니다. */
  await sql`
    DELETE FROM screener_snapshot
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY market ORDER BY created_at DESC) AS n
        FROM screener_snapshot) t
      WHERE t.n <= 5)`

  // 홈 화면의 US 히트맵 자료 — 상자 크기가 시가총액입니다.
  //  시가총액은 발행주식수가 있어야 계산되는데, 그건 서버가 하룻밤 걸려 받아 둡니다.
  //  사이트가 직접 받을 수 없어 이렇게 함께 올려받습니다.
  if (market === 'US' && Array.isArray(body.heat) && body.heat.length) {
    try {
      await ensureSettings(sql)
      const v = JSON.stringify({
        at: new Date().toISOString(), stamp, list: body.heat.slice(0, 600),
      })
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES ('us_heat', ${v}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
    } catch { /* 히트맵을 못 저장해도 스크리닝 결과는 살립니다 */ }
  }

  /* ── 업종별 통과 종목 수를 따로 적어 둡니다 (2026-08-23) ──────────────
     화면의 [업종별 통과 종목] 막대 오른쪽에 **직전 스크리너 대비 증감**을
     적으려는 것입니다.

     왜 여기서 세나 — 결과 전체(payload)는 2MB 가 넘습니다. 화면이 열릴 때마다
     직전 것까지 두 벌을 읽어 세면 느려집니다. 올라올 때 한 번만 세어
     **작은 표**로 남겨 두면, 화면은 그 표만 읽으면 됩니다.
     2026-09-01 (Jun 요청) — 10회분 → **최근 30일치**. 스크리너가 하루 네 번
     도니 10회분은 사흘도 안 됐습니다. 추이를 보려면 한 달은 있어야 합니다.
     줄 하나가 업종 20개쯤의 숫자라 작습니다 — 30일치도 몇십 KB 입니다. */
  try {
    await ensureSettings(sql)
    const cnt = {}
    //  2026-10-04 — 화면과 같은 기준으로 셉니다: 트레이딩 부적합(부적합사유)도 뺍니다.
    //  전에는 부적합을 포함해 세어서, 부적합을 뺀 화면 막대와 증감이 어긋났습니다
    //  (반도체 23→24 로 늘었는데 화면에는 21(−2)). basis:'main' 이 새 기준 표시입니다.
    for (const r of main) {
      if (r['판정'] !== '통과' || r['부적합사유']) continue
      const k = String(r['업종'] || '-')
      cnt[k] = (cnt[k] || 0) + 1
    }
    const key = `sector_hist_${market}`
    const got = await sql`SELECT value FROM screener_settings WHERE key = ${key}`
    const hist = Array.isArray(got[0]?.value?.list) ? got[0].value.list : []
    // 같은 stamp 로 다시 올라오면 덮어씁니다 (재실행 시 줄이 겹치지 않도록)
    //  30일보다 오래된 줄은 버립니다 (stamp 는 'YYYY-MM-DD HH:MM' 꼴이라 앞 10자만 봅니다)
    const cut = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    const kept = hist.filter((x) => x && x.stamp !== stamp
                                 && String(x.stamp).slice(0, 10) >= cut)
    kept.push({ stamp, cnt, basis: 'main' })
    //  하루 네 번 × 30일 = 120줄. 넉넉히 200줄까지만 (자료가 어긋나도 안 불어나게)
    const v = JSON.stringify({ list: kept.slice(-200) })
    await sql`
      INSERT INTO screener_settings (key, value, updated_at)
      VALUES (${key}, ${v}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
  } catch { /* 못 적어도 스크리닝 결과는 살립니다 */ }

  /* 수동 요청을 '끝남' 으로 적습니다.

     2026-09-19 에 `market === 'KR'` 조건을 뺐습니다. 수동 실행은 한국·미국을
     연달아 도는데(서버 tools/agent.py), 끝났다고 적어 주는 것이 **한국 결과가
     올라올 때뿐**이었습니다. 그래서 한국 쪽이 실패한 날에는 미국 결과가 멀쩡히
     올라왔는데도 단추가 계속 '진행 중' 이었고, 100분짜리 청소가 돌기 전까지
     풀리지 않았습니다. 9/19 가 그런 날이었습니다 — 미국은 15:57 에 끝났는데
     화면은 40분 넘게 돌고 있다고 했습니다.

     누른 시장이 먼저 돌므로(아래 job 라우트가 market 을 알려 줍니다), 첫 업로드는
     **누른 쪽의 결과**입니다. 그때 풀어 주는 것이 화면에서 기다리는 사람 기준으로
     맞습니다. 나머지 한 시장은 뒤에서 이어서 돌고, 그 업로드는 이 줄에 걸릴 것이
     없어 아무 일도 하지 않습니다. */
  await sql`UPDATE screener_job SET status='done', finished_at=now()
            WHERE status IN ('requested','running')`

  return NextResponse.json({ ok: true, market, rows: rows.length, passed, stamp })
}

// AWS 서버가 워치리스트를 가져갈 때 사용 — 관리자 계정의 워치리스트를 돌려줍니다.
export async function GET(request) {
  if (!keyOk(request)) return NextResponse.json({ ok: false }, { status: 401 })
  const sql = await getSql()
  let watchlist = []
  try {
    const r = await sql`
      SELECT d.data FROM screener_user_data d
      JOIN screener_user u ON u.id = d.user_id
      WHERE u.role = 'admin' ORDER BY u.id LIMIT 1`
    const w = r[0]?.data?.watchlist
    if (Array.isArray(w)) watchlist = w
  } catch (e) {
    watchlist = []
  }
  return NextResponse.json({ ok: true, watchlist })
}

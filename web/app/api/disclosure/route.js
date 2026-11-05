// ============================================================
//  종목별 최신 공시
//  · 워치리스트 카드와 검색 상세에서 씁니다.
//  · /api/disclosure?codes=131290,219130,AAPL,AKTS,...
//  · 종목마다 30분 동안은 저장해 둔 값을 그대로 씁니다.
//  · 회사 대응표(종목코드 → DART 고유번호)는 7일에 한 번만 새로 받습니다.
//
//  2026-08-23: **미국 종목을 넣었습니다.**
//   예전에는 종목코드에서 숫자만 남기고 6자리인 것만 남겨서, 미국 티커는
//   목록에서 통째로 빠졌습니다 → 화면에 "공시를 불러오지 못했습니다".
//   이제 6자리 숫자는 DART(한국), 알파벳 티커는 SEC EDGAR(미국)로 갈라 보냅니다.
//   미국 회사의 IR 보도자료는 8-K 에 EX-99 로 붙으므로, 8-K 는 본문 대신
//   **첨부까지 보이는 제출 목록 페이지**로 연결합니다 (lib/sec.js 참고).
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import {
  fetchCorpMap, fetchCorpDisclosures, CORPMAP_KEY, CORPMAP_TTL, CORPMAP_VER,
} from '@/lib/dart'
import {
  fetchTickerMap, fetchSecFilings, TICKMAP_KEY, TICKMAP_TTL, TICKMAP_VER,
} from '@/lib/sec'
import { currentUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TTL = 30 * 60 * 1000        // 종목별 공시 30분
const CACHE_KEY = 'disc_by_code'
const US_CACHE_KEY = 'disc_by_sym'      // 미국(SEC)은 따로 담아 둡니다
const MAX_CODES = 24              // 한 번에 물어볼 수 있는 종목 수
const PER = 3                     // 종목당 보여줄 공시 건수

const json = (o, init) => NextResponse.json(o,
  { ...init, headers: { 'content-type': 'application/json; charset=utf-8' } })

/* 대응표 — 없거나 오래됐으면 새로 받아 저장합니다 */
async function corpMap(sql, { fresh = false } = {}) {
  if (sql) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings
                          WHERE key = ${CORPMAP_KEY}`
      // 판번호가 다르면 예전 방식으로 만든 표입니다 — 버리고 새로 받습니다
      // 서울 서버가 보내 준 표는 오래돼도 씁니다. 없는 것보다 낫고,
      //  회사 고유번호는 거의 바뀌지 않습니다(새 상장사만 늘어납니다).
      if (r.length && r[0].value?.map && r[0].value?.v === CORPMAP_VER) {
        const old = Date.now() - new Date(r[0].updated_at).getTime() > CORPMAP_TTL
        if (!fresh || !old) return r[0].value.map
      }
    } catch { /* 없으면 새로 받습니다 */ }
  }
  // 여기까지 왔다는 건 서울 서버가 아직 표를 보내지 않았다는 뜻입니다.
  //  비상용으로 직접 받아 보되, 오래 걸리면 포기합니다(화면이 멎지 않도록).
  const map = await fetchCorpMap()
  if (sql) {
    try {
      const v = JSON.stringify({ v: CORPMAP_VER, n: Object.keys(map).length, map })
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES (${CORPMAP_KEY}, ${v}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
    } catch { /* 저장 실패해도 이번 요청은 처리합니다 */ }
  }
  return map
}

/* 미국 티커 → CIK 대응표. DART 대응표와 같은 방식으로 7일 담아 둡니다. */
async function tickMap(sql, { fresh = false } = {}) {
  if (sql) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings
                          WHERE key = ${TICKMAP_KEY}`
      if (r.length && r[0].value?.map && r[0].value?.v === TICKMAP_VER) {
        const old = Date.now() - new Date(r[0].updated_at).getTime() > TICKMAP_TTL
        if (!fresh || !old) return r[0].value.map
      }
    } catch { /* 없으면 새로 받습니다 */ }
  }
  const map = await fetchTickerMap()
  if (sql) {
    try {
      const v = JSON.stringify({ v: TICKMAP_VER, n: Object.keys(map).length, map })
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES (${TICKMAP_KEY}, ${v}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
    } catch { /* 저장 실패해도 이번 요청은 처리합니다 */ }
  }
  return map
}

export async function GET(request) {
  const q = new URL(request.url).searchParams
  // 6자리 숫자 = 한국(DART) · 알파벳 티커 = 미국(SEC)
  //  화면이 소문자 티커('aapl')를 보내도 되도록, 원래 글자와 대문자를 함께 기억합니다.
  const raws = [...new Set(String(q.get('codes') || '')
    .split(',').map((c) => c.trim()).filter(Boolean))].slice(0, MAX_CODES)
  const alias = {}                                  // 대문자 → 화면이 보낸 원래 글자
  for (const r of raws) { const u = r.toUpperCase(); if (u !== r) alias[u] = r }
  const asked = [...new Set(raws.map((c) => c.toUpperCase()))]
  const codes = asked.filter((c) => /^\d{6}$/.test(c))
  const syms = asked.filter((c) => /^[A-Z][A-Z.\-]{0,6}$/.test(c))
  if (!codes.length && !syms.length) return json({ ok: true, by: {}, errors: [] })

  // ?refresh=1 — 담아 둔 값을 모두 버리고 새로 받습니다 (관리자 또는 열쇠)
  let fresh = q.get('refresh') === '1'
  if (fresh) {
    const key = request.headers.get('x-screener-key') || ''
    let ok = !!(process.env.SCREENER_KEY && key === process.env.SCREENER_KEY)
    if (!ok) { try { const u = await currentUser(); ok = !!(u && u.role === 'admin') } catch { /* 손님 */ } }
    if (!ok) fresh = false
  }

  let sql = null
  try { sql = await getSql(); await ensureSettings(sql) } catch { sql = null }

  // 저장해 둔 값 먼저 꺼냅니다
  let store = {}
  if (sql && !fresh) {
    try {
      const r = await sql`SELECT value FROM screener_settings WHERE key = ${CACHE_KEY}`
      if (r.length && r[0].value && typeof r[0].value === 'object') store = r[0].value
    } catch { /* 없으면 빈 채로 */ }
  }

  const now = Date.now()
  const by = {}
  const errors = []
  const need = []
  let mapSize = null
  for (const c of codes) {
    const hit = store[c]
    if (hit && now - (hit.t || 0) < TTL) by[c] = hit.items || []
    else need.push(c)
  }

  if (need.length) {
    let map = null
    try { map = await corpMap(sql, { fresh }) } catch (e) {
      errors.push(`회사 대응표: ${e?.message || e}`)
    }
    if (map) {
      mapSize = Object.keys(map).length
      // 한꺼번에 물어봅니다. 하나가 실패해도 나머지는 보여줍니다.
      const got = await Promise.all(need.map(async (c) => {
        const cc = map[c]
        if (!cc) return [c, [], '전자공시에 등록되지 않은 종목입니다']
        try { return [c, await fetchCorpDisclosures(cc, { max: PER }), null] }
        catch (e) { return [c, null, String(e?.message || e)] }
      }))
      for (const [c, items, err] of got) {
        // 불러오다 실패한 것과 '정말 공시가 없는 것' 은 구별합니다.
        //  실패를 빈 목록으로 돌려주면 화면에는 '공시가 없습니다' 로 보이고,
        //  그 빈 목록이 30분 동안 저장돼 멀쩡한 종목까지 계속 비어 보입니다.
        if (err && items == null) { errors.push(`${c}: ${err}`); by[c] = null; continue }
        if (err) errors.push(`${c}: ${err}`)
        by[c] = items
        store[c] = { t: now, items }          // 못 찾은 종목도 30분은 다시 묻지 않습니다
      }
      if (sql) {
        try {
          // 오래된 것은 버려 저장값이 계속 커지지 않게 합니다
          const keep = {}
          for (const [k, v] of Object.entries(store))
            if (now - (v?.t || 0) < 3 * TTL) keep[k] = v
          const v = JSON.stringify(keep)
          await sql`
            INSERT INTO screener_settings (key, value, updated_at)
            VALUES (${CACHE_KEY}, ${v}::jsonb, now())
            ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
        } catch { /* 저장 실패해도 화면은 보여줍니다 */ }
      }
    } else {
      // 대응표 자체를 못 받았습니다 — '없음' 이 아니라 '실패' 입니다
      for (const c of need) by[c] = null
    }
  }

  // ── 미국 (SEC EDGAR) ──────────────────────────────────────
  //  구조는 위 한국 쪽과 같습니다. 저장 자리만 따로 씁니다.
  if (syms.length) {
    let ustore = {}
    if (sql && !fresh) {
      try {
        const r = await sql`SELECT value FROM screener_settings WHERE key = ${US_CACHE_KEY}`
        if (r.length && r[0].value && typeof r[0].value === 'object') ustore = r[0].value
      } catch { /* 없으면 빈 채로 */ }
    }
    const uneed = []
    for (const s2 of syms) {
      const hit = ustore[s2]
      if (hit && now - (hit.t || 0) < TTL) by[s2] = hit.items || []
      else uneed.push(s2)
    }
    if (uneed.length) {
      let tmap = null
      try { tmap = await tickMap(sql, { fresh }) } catch (e) {
        errors.push(`SEC 티커표: ${e?.message || e}`)
      }
      if (tmap) {
        // SEC 는 초당 10회까지만 허용합니다. 한 번에 여러 종목을 물어볼 때는
        //  네 개씩 끊어서 보냅니다 (화면에 뜨는 종목은 보통 한두 개입니다).
        const got = []
        for (let i = 0; i < uneed.length; i += 4) {
          const part = await Promise.all(uneed.slice(i, i + 4).map(async (s2) => {
            const cik = tmap[s2]
            if (!cik) return [s2, [], 'SEC 에 등록되지 않은 티커입니다']
            try { return [s2, await fetchSecFilings(cik, { max: PER }), null] }
            catch (e) { return [s2, null, String(e?.message || e)] }
          }))
          got.push(...part)
        }
        for (const [s2, items, err] of got) {
          if (err && items == null) { errors.push(`${s2}: ${err}`); by[s2] = null; continue }
          if (err) errors.push(`${s2}: ${err}`)
          by[s2] = items
          ustore[s2] = { t: now, items }
        }
        if (sql) {
          try {
            const keep = {}
            for (const [k, v] of Object.entries(ustore))
              if (now - (v?.t || 0) < 3 * TTL) keep[k] = v
            const v = JSON.stringify(keep)
            await sql`
              INSERT INTO screener_settings (key, value, updated_at)
              VALUES (${US_CACHE_KEY}, ${v}::jsonb, now())
              ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
          } catch { /* 저장 실패해도 화면은 보여줍니다 */ }
        }
      } else {
        for (const s2 of uneed) by[s2] = null
      }
    }
  }

  // 화면이 소문자로 물어봤으면 그 이름으로도 답을 넣어 줍니다
  for (const [u, orig] of Object.entries(alias)) if (u in by) by[orig] = by[u]

  return json({ ok: true, by, errors, ...(q.get('debug') === '1' ? { 표: mapSize } : {}) })
}

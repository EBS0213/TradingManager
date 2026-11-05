// ============================================================
//  지표 화면 자료 만들기 (2026-08-27)
//
//  화면 하나에 **미국 지표**와 **한국 지표**를 나란히 놓습니다.
//  자료가 두 갈래에서 옵니다 — 이게 이 파일의 전부입니다.
//
//   ① 이 서버(미국 Vercel)에서 바로 받을 수 있는 것
//        지수 · 환율 · 유가/금 · VIX   → lib/macro.js 가 이미 하고 있습니다
//   ② 여기서 받을 수 없는 것
//        FRED(미국 거시) · 한국은행 ECOS(한국 거시)
//        → **서울 AWS 서버**가 하루 한 번 받아서 POST /api/macro 로 밀어 넣습니다.
//          버핏지수와 똑같은 방식입니다 (FRED 는 Vercel 에서 25초를 기다려도
//          응답이 오지 않습니다 — 차단이지 고장이 아닙니다).
//
//  그래서 화면은 ①과 ②를 합친 것을 봅니다. ②가 아직 안 왔으면 ①만 나옵니다
//  (칸이 통째로 사라지지 않고 '아직 받지 못했습니다' 라고 적힙니다).
// ============================================================
import { fetchMacro } from '@/lib/macro'

export const PUSH_KEY = 'macro_push'

/** 저장해 둔 '서울이 밀어 넣은 지표' 를 읽습니다 */
export async function readPushed(sql) {
  if (!sql) return null
  try {
    const r = await sql`SELECT value FROM screener_settings WHERE key = ${PUSH_KEY}`
    return r.length ? r[0].value : null
  } catch { return null }
}

/* 한 줄 다듬기 — 숫자가 아닌 것이 섞여 들어오면 그 줄만 버립니다 */
function cleanRow(x) {
  const v = Number(x?.value)
  if (!Number.isFinite(v)) return null
  const chg = (Array.isArray(x.chg) ? x.chg : [])
    .map((c) => ({
      k: String(c?.k || '').slice(0, 8),
      v: Number.isFinite(Number(c?.v)) ? Number(c.v) : null,
      p: Number.isFinite(Number(c?.p)) ? Number(c.p) : null,
    }))
    .filter((c) => c.k && (c.v != null || c.p != null))
    .slice(0, 3)
  return {
    name: String(x.name || '').slice(0, 40),
    en: String(x.en || '').slice(0, 90),
    value: v,
    unit: String(x.unit || '').slice(0, 12),
    day: String(x.day || '').slice(0, 10),
    chg,
  }
}

/** 밀어 넣을 때 한 번 걸러 둡니다 (화면에서 다시 검사하지 않게) */
export function cleanGroups(groups) {
  return (Array.isArray(groups) ? groups : []).slice(0, 24).map((g) => ({
    key: String(g?.key || '').slice(0, 24),
    label: String(g?.label || '').slice(0, 30),
    side: g?.side === 'KR' ? 'KR' : 'US',
    src: String(g?.src || '').slice(0, 20),
    rows: (Array.isArray(g?.rows) ? g.rows : []).slice(0, 30).map(cleanRow).filter(Boolean),
  })).filter((g) => g.key && g.rows.length)
}

/* ── 이 서버에서 바로 받는 것들을 화면용 묶음으로 ── */
function liveGroups(items) {
  const pick = (names) => names
    .map((n) => items.find((x) => x.name === n))
    .filter(Boolean)
    .map((x) => ({
      name: x.name, en: '', value: x.price,
      unit: x.group === '환율' ? '원' : (x.group === '금리' ? '%' : ''),
      day: x.day || '',
      chg: [{ k: 'DoD', v: x.diff ?? null, p: x.rate ?? null }],
    }))

  const out = []
  const us = pick(['S&P500', '나스닥', '다우', 'VIX'])
  if (us.length) out.push({ key: 'us_idx', label: '미국 증시(실시간)', side: 'US', src: '네이버', rows: us })
  const rate = pick(['미국 10년물', '미국 2년물'])
  if (rate.length) out.push({ key: 'us_rate_live', label: '미국 국채금리', side: 'US', src: 'FRED', rows: rate })
  const raw = pick(['WTI', '두바이유', '국제 금', '휘발유'])
  if (raw.length) out.push({ key: 'raw', label: '원자재(실시간)', side: 'US', src: '네이버', rows: raw })
  const fx = pick(['원/달러', '원/엔(100엔)', '원/유로', '원/위안'])
  if (fx.length) out.push({ key: 'kr_fx', label: '환율(원화 기준)', side: 'KR', src: 'ECB', rows: fx })
  const asia = pick(['닛케이225', '상해종합', '대만 가권', '유로스톡스50'])
  if (asia.length) out.push({ key: 'world', label: '아시아 · 유럽 증시', side: 'KR', src: '네이버', rows: asia })
  return out
}

/**
 * 화면이 그대로 그릴 수 있는 모양으로 돌려줍니다.
 * @returns {{ok:true, at:string, pushedAt:string|null, groups:Array}}
 */
export async function buildMacroFeed(sql) {
  const [live, pushed] = await Promise.all([
    fetchMacro().catch(() => ({ items: [], errors: ['거시 자료를 받지 못했습니다'] })),
    readPushed(sql),
  ])
  const fromSeoul = cleanGroups(pushed?.groups)
  /* 서울이 진짜 FRED 값을 보내 주면, 임시로 쓰던 실시간 칸은 비킵니다.
     안 그러면 '미국 국채 10년' 이 두 칸에 서로 다른 날짜로 두 번 나옵니다.
     왼쪽이 서울이 준 묶음, 오른쪽이 비켜야 할 실시간 묶음입니다. */
  const REPLACED = { us_rate: 'us_rate_live', us_market: 'us_idx' }
  const hide = new Set()
  for (const [seoulKey, liveKey] of Object.entries(REPLACED)) {
    if (fromSeoul.some((g) => g.key === seoulKey)) hide.add(liveKey)
  }
  const groups = [
    ...liveGroups(live.items || []).filter((g) => !hide.has(g.key)),
    ...fromSeoul,
  ]
  // 미국 먼저, 한국 나중 — 화면이 두 칸으로 나눌 때 순서를 그대로 씁니다
  groups.sort((a, b) => (a.side === b.side ? 0 : a.side === 'US' ? -1 : 1))
  return {
    ok: true,
    at: new Date().toISOString(),
    pushedAt: pushed?.at || null,
    errors: live.errors || [],
    groups,
  }
}

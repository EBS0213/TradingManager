// ============================================================
//  한국투자증권 OpenAPI — 공통 창구
//
//  왜 만들었나 (2026-09-10)
//   지금까지 한국 시세는 네이버 금융 화면을 긁어 왔습니다(lib/naver.js).
//   표 모양이 조금만 바뀌어도 통째로 깨지고, 실제로 '상승률을 못 읽으면
//   시가총액 표에서 대신 뽑는' 임시 처방까지 들어가 있었습니다.
//   한국투자증권이 정식 API 를 열어 두었으니 그쪽으로 옮깁니다.
//
//  꼭 알아 둘 세 가지
//   ① **토큰은 하루짜리인데 발급은 1분에 한 번뿐**입니다.
//      Vercel 은 호출마다 프로세스가 새로 뜨므로, 토큰을 메모리에만 두면
//      금방 '1분당 1회' 오류(EGW00133)에 걸립니다. 그래서 데이터베이스
//      (screener_settings 표)에 담아 두고 모두가 나눠 씁니다.
//   ② **초당 20건** 제한이 있습니다. 여러 개를 한꺼번에 부를 때는
//      kisAll() 로 묶어서 보내세요 — 몇 개씩 끊어서 보냅니다.
//   ③ **모의투자 앱키로는 대부분 막힙니다.** 순위·시세분석은 실전 전용입니다.
// ============================================================

import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'

const BASE = 'https://openapi.koreainvestment.com:9443'
const TOKEN_KEY = 'kis_token'          // screener_settings 에 담을 이름

const APPKEY = () => process.env.KIS_APP_KEY || ''
const APPSECRET = () => process.env.KIS_APP_SECRET || ''

/** 열쇠가 준비돼 있는지. 없으면 부르는 쪽에서 네이버로 되돌아갑니다. */
export function hasKis() {
  return Boolean(APPKEY() && APPSECRET())
}

// ── 토큰 ─────────────────────────────────────────────────

/* 같은 프로세스가 살아 있는 동안은 여기서 바로 씁니다.
   {token, exp} — exp 는 밀리초 시각입니다. */
let _mem = null

const TOKEN_MARGIN = 30 * 60 * 1000    // 만료 30분 전이면 미리 새로 받습니다

async function readTokenFromDb() {
  try {
    const sql = await getSql()
    await ensureSettings(sql)
    const r = await sql`SELECT value FROM screener_settings WHERE key = ${TOKEN_KEY}`
    const v = r.length ? r[0].value : null
    if (v && v.token && v.exp && Date.now() < v.exp - TOKEN_MARGIN) return v
  } catch { /* 데이터베이스가 없으면 그냥 새로 받습니다 */ }
  return null
}

async function saveTokenToDb(v) {
  try {
    const sql = await getSql()
    await ensureSettings(sql)
    const json = JSON.stringify(v)
    await sql`
      INSERT INTO screener_settings (key, value, updated_at)
      VALUES (${TOKEN_KEY}, ${json}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = now()`
  } catch { /* 못 담아도 이번 호출은 됩니다 */ }
}

/* 토큰을 새로 발급받습니다.
   성공하면 {token, exp}, '1분당 1회' 에 걸리면 null 을 돌려줍니다
   (그 경우 다른 프로세스가 방금 받아 두었을 수 있어 데이터베이스를 다시 봅니다). */
async function issueToken() {
  const r = await fetch(`${BASE}/oauth2/tokenP`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: APPKEY(),
      appsecret: APPSECRET(),
    }),
  })
  const text = await r.text()
  let j = null
  try { j = JSON.parse(text) } catch { /* 아래에서 처리 */ }

  if (j && j.access_token) {
    // expires_in 은 초 단위(보통 86400). 넉넉히 잡지 말고 그대로 씁니다.
    const sec = Number(j.expires_in) || 86400
    return { token: j.access_token, exp: Date.now() + sec * 1000 }
  }
  // EGW00133 = '접근토큰 발급 잠시 후 다시 시도하세요(1분당 1회)'
  if (j && String(j.error_code || j.msg_cd || '') === 'EGW00133') return null
  throw new Error(`한국투자증권 토큰 발급 실패: ${j?.error_description || j?.msg1 || text.slice(0, 200)}`)
}

/** 쓸 수 있는 접근토큰을 돌려줍니다 (메모리 → 데이터베이스 → 새 발급 차례로). */
export async function kisToken() {
  if (!hasKis()) throw new Error('한국투자증권 열쇠(KIS_APP_KEY·KIS_APP_SECRET)가 없습니다')
  if (_mem && Date.now() < _mem.exp - TOKEN_MARGIN) return _mem.token

  const fromDb = await readTokenFromDb()
  if (fromDb) { _mem = fromDb; return fromDb.token }

  const fresh = await issueToken()
  if (fresh) { _mem = fresh; await saveTokenToDb(fresh); return fresh.token }

  /* 1분 제한에 걸렸습니다. 다른 프로세스가 방금 받아 담았을 수 있으니
     여유 없이 한 번 더 봅니다 (이번엔 만료 여유를 두지 않습니다). */
  try {
    const sql = await getSql()
    const r = await sql`SELECT value FROM screener_settings WHERE key = ${TOKEN_KEY}`
    const v = r.length ? r[0].value : null
    if (v && v.token && Date.now() < v.exp) { _mem = v; return v.token }
  } catch { /* 아래로 */ }
  throw new Error('한국투자증권 토큰을 받지 못했습니다 (1분에 한 번만 발급됩니다 — 잠시 뒤 다시 시도하세요)')
}

// ── 호출 ─────────────────────────────────────────────────

const TIMEOUT = 10000

/**
 * 시세 API 한 번 부르기.
 *  path   — '/uapi/domestic-stock/v1/quotations/inquire-price'
 *  trId   — 'FHKST01010100'
 *  params — 조회 조건 (대문자로 바꿔 물음표 뒤에 붙습니다)
 *  opt.cont — 이어받기용. {tr_cont:'N', fk:'', nk:''}
 *
 * 돌려주는 것: { body, cont }
 *   body — 응답 본문 그대로 (output · output1 · output2 …)
 *   cont — 더 받을 게 있으면 {tr_cont:'N', fk, nk}, 없으면 null
 */
export async function kis(path, trId, params = {}, opt = {}) {
  const token = await kisToken()
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    qs.set(k.toUpperCase(), String(v))
  }

  const headers = {
    'content-type': 'application/json; charset=utf-8',
    authorization: `Bearer ${token}`,
    appkey: APPKEY(),
    appsecret: APPSECRET(),
    tr_id: trId,
    custtype: 'P',                       // 개인
    tr_cont: opt.cont?.tr_cont || '',
  }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opt.timeout || TIMEOUT)
  let r
  try {
    const url = `${BASE}${path}?${qs.toString()}`
      + (opt.cont?.fk ? `&CTX_AREA_FK100=${encodeURIComponent(opt.cont.fk)}` : '')
      + (opt.cont?.nk ? `&CTX_AREA_NK100=${encodeURIComponent(opt.cont.nk)}` : '')
    r = await fetch(url, { cache: 'no-store', signal: ac.signal, headers })
  } catch (e) {
    throw new Error(e?.name === 'AbortError'
      ? '한국투자증권이 제때 답하지 않았습니다'
      : `한국투자증권에 닿지 못했습니다 (${e?.message || e})`)
  } finally { clearTimeout(timer) }

  const text = await r.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* 아래에서 처리 */ }
  if (!body) throw new Error(`한국투자증권 응답을 읽지 못했습니다 (HTTP ${r.status})`)

  /* 토큰이 만료됐다는 답이면 한 번만 새로 받아 다시 부릅니다.
     (하루가 지나 데이터베이스에 담긴 토큰이 낡았을 때 여기로 옵니다) */
  if (!opt._retried && (body.msg_cd === 'EGW00123' || body.msg_cd === 'EGW00121')) {
    _mem = null
    try {
      const sql = await getSql()
      await sql`DELETE FROM screener_settings WHERE key = ${TOKEN_KEY}`
    } catch { /* 지우지 못해도 메모리는 비웠습니다 */ }
    return kis(path, trId, params, { ...opt, _retried: true })
  }

  if (body.rt_cd !== undefined && String(body.rt_cd) !== '0')
    throw new Error(`한국투자증권 오류 ${body.msg_cd || ''}: ${body.msg1 || ''}`.trim())

  const trCont = r.headers.get('tr_cont') || ''
  const more = trCont === 'M' || trCont === 'F'
  return {
    body,
    cont: more
      ? { tr_cont: 'N', fk: body.ctx_area_fk100 || '', nk: body.ctx_area_nk100 || '' }
      : null,
  }
}

/**
 * 이어받기까지 해서 목록을 다 모읍니다 (순위표처럼 30줄씩 끊어 오는 것들).
 *  pick — 응답 본문에서 배열을 꺼내는 함수 (기본은 output)
 *  max  — 이만큼 모이면 그만둡니다
 */
export async function kisList(path, trId, params, { pick = (b) => b.output, max = 200, pages = 8 } = {}) {
  const out = []
  let cont = null
  for (let i = 0; i < pages; i += 1) {
    const { body, cont: next } = await kis(path, trId, params, cont ? { cont } : {})
    const arr = pick(body)
    if (Array.isArray(arr)) out.push(...arr)
    if (out.length >= max || !next) break
    cont = next
  }
  return out.slice(0, max)
}

/**
 * 여러 개를 부르되 **초당 20건** 제한을 지킵니다.
 *  tasks — () => Promise 배열
 * 한 번에 8개씩 보내고 사이에 살짝 쉽니다. 넉넉히 잡은 값입니다 —
 * 제한에 걸리면 그 호출만 오류가 나는 게 아니라 한동안 전부 막힙니다.
 */
export async function kisAll(tasks, size = 8, gap = 120) {
  const out = []
  for (let i = 0; i < tasks.length; i += size) {
    const part = tasks.slice(i, i + size)
    out.push(...await Promise.all(part.map((f) => f())))
    if (i + size < tasks.length) await new Promise((r) => setTimeout(r, gap))
  }
  return out
}

// ── 숫자 다듬기 ───────────────────────────────────────────

/** 한국투자증권은 모든 값을 글자로 보냅니다. 숫자로 바꾸되 빈 값은 null 로. */
export const num = (v) => {
  if (v === undefined || v === null) return null
  const s = String(v).trim().replace(/,/g, '')
  if (!s || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** 전일대비 부호. 1 상한 · 2 상승 · 3 보합 · 4 하한 · 5 하락 */
export const signOf = (v) => {
  const s = String(v || '')
  if (s === '1' || s === '2') return 1
  if (s === '4' || s === '5') return -1
  return 0
}

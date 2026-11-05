// ============================================================
//  API 키 — 회원이 우리 한국 데이터를 프로그램으로 받아 가는 열쇠 (2026-10-08)
//
//  · 한 사람에 키 하나. 다시 발급하면 옛 키는 그 자리에서 못 쓰게 됩니다.
//  · 키 원문은 발급할 때 한 번만 보여 주고, DB 에는 sha256 해시만 남깁니다.
//    (DB 가 새어 나가도 키를 되살릴 수 없습니다)
//  · 조회 전용입니다. 이 키로 할 수 있는 일은 /api/v1/kr/* 를 읽는 것뿐입니다.
//  · 미국 자료(Massive 유료)는 이 키로 열지 않습니다 — 재배포 조건 때문입니다.
//  · 시세(일봉)도 열지 않습니다 (2026-10-08) — 원자료가 네이버·KIS 라 재배포 약관에
//    걸리기 쉽습니다. 우리가 계산한 스크리너 결과만 내줍니다.
// ============================================================
import crypto from 'crypto'
import { ensureTables } from '@/lib/auth'
import { tooMany } from '@/lib/limit'

const PREFIX = 'tmk_'

// 횟수 제한 — Vercel 무료 등급의 CPU 한도(2026-10-07 경고)를 지키려는 값입니다
export const LIMIT_PER_MIN = 30
export const LIMIT_PER_DAY = 2000

let _ready = false
export async function ensureApiKeyTable(sql) {
  if (_ready) return
  await ensureTables(sql)
  await sql`
    CREATE TABLE IF NOT EXISTS screener_apikey (
      user_id    BIGINT PRIMARY KEY REFERENCES screener_user(id) ON DELETE CASCADE,
      key_hash   TEXT UNIQUE NOT NULL,
      hint       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used  TIMESTAMPTZ,
      uses       BIGINT NOT NULL DEFAULT 0
    )`
  _ready = true
}

const hashKey = (k) => crypto.createHash('sha256').update(String(k)).digest('hex')

/** 내 키 상태 (원문은 없습니다 — 앞뒤 몇 글자만) */
export async function keyStatus(sql, userId) {
  await ensureApiKeyTable(sql)
  const r = await sql`
    SELECT hint, created_at, last_used, uses FROM screener_apikey WHERE user_id = ${userId}`
  return r.length ? r[0] : null
}

/** 새 키를 만듭니다. 옛 키는 덮어써서 바로 무효가 됩니다. 원문을 돌려줍니다. */
export async function issueKey(sql, userId) {
  await ensureApiKeyTable(sql)
  const plain = PREFIX + crypto.randomBytes(24).toString('base64url')
  const hint = `${plain.slice(0, 8)}…${plain.slice(-4)}`
  const h = hashKey(plain)
  await sql`
    INSERT INTO screener_apikey (user_id, key_hash, hint)
    VALUES (${userId}, ${h}, ${hint})
    ON CONFLICT (user_id) DO UPDATE
      SET key_hash = ${h}, hint = ${hint}, created_at = now(), last_used = NULL, uses = 0`
  return { key: plain, hint }
}

export async function revokeKey(sql, userId) {
  await ensureApiKeyTable(sql)
  await sql`DELETE FROM screener_apikey WHERE user_id = ${userId}`
}

/** 요청에 실린 키를 읽습니다. Authorization: Bearer … 또는 X-API-Key: … */
function readKey(request) {
  const h = request.headers
  const auth = h.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(\S+)$/i)
  const k = (m ? m[1] : h.get('x-api-key') || '').trim()
  return k.startsWith(PREFIX) && k.length < 100 ? k : null
}

/**
 * API 요청을 확인합니다.
 * @returns {{user} | {error, status}}
 */
export async function checkApiKey(sql, request) {
  const k = readKey(request)
  if (!k) return { error: 'API 키가 없습니다. Authorization: Bearer <키> 로 보내 주세요.', status: 401 }
  await ensureApiKeyTable(sql)
  const r = await sql`
    SELECT k.user_id, u.verified FROM screener_apikey k
    JOIN screener_user u ON u.id = k.user_id
    WHERE k.key_hash = ${hashKey(k)}`
  if (!r.length) return { error: '쓸 수 없는 API 키입니다.', status: 401 }
  if (!r[0].verified) return { error: '이메일 인증을 마친 계정만 쓸 수 있습니다.', status: 403 }
  const uid = r[0].user_id
  if (await tooMany(sql, `api:m:${uid}`, LIMIT_PER_MIN, 1))
    return { error: `요청이 너무 잦습니다 (분당 ${LIMIT_PER_MIN}회).`, status: 429 }
  if (await tooMany(sql, `api:d:${uid}`, LIMIT_PER_DAY, 1440))
    return { error: `오늘 쓸 수 있는 횟수를 다 썼습니다 (하루 ${LIMIT_PER_DAY}회).`, status: 429 }
  try {
    await sql`UPDATE screener_apikey SET last_used = now(), uses = uses + 1 WHERE user_id = ${uid}`
  } catch { /* 기록 실패해도 답은 줍니다 */ }
  return { user: { id: uid } }
}

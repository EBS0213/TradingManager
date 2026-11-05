// ============================================================
//  횟수 제한 — 비밀번호 찍어보기, 메일 폭탄 등을 막습니다.
//  기록은 DB 표 하나에 남기고, 오래된 것은 지웁니다.
// ============================================================
let _ready = false

export async function ensureLimit(sql) {
  if (_ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS screener_attempt (
      id     BIGSERIAL PRIMARY KEY,
      bucket TEXT NOT NULL,
      at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  await sql`CREATE INDEX IF NOT EXISTS screener_attempt_b ON screener_attempt (bucket, at)`
  _ready = true
}

/** 접속자 구분용 주소 (Vercel 이 넣어 주는 값) */
export function clientIp(request) {
  const h = request.headers
  return (h.get('x-forwarded-for') || '').split(',')[0].trim()
    || h.get('x-real-ip') || 'unknown'
}

/**
 * 한 번 시도했다고 적고, 최근 windowMin 분 안에 max 번을 넘었는지 알려줍니다.
 * @returns {boolean} true 면 "너무 잦음"
 */
export async function tooMany(sql, bucket, max, windowMin) {
  try {
    await ensureLimit(sql)
    await sql`INSERT INTO screener_attempt (bucket) VALUES (${bucket})`
    const r = await sql`
      SELECT count(*)::int AS n FROM screener_attempt
      WHERE bucket = ${bucket} AND at > now() - (${windowMin} || ' minutes')::interval`
    // 하루 지난 기록은 정리 (가끔씩만)
    if ((r[0]?.n || 0) % 17 === 0)
      await sql`DELETE FROM screener_attempt WHERE at < now() - interval '1 day'`
    return (r[0]?.n || 0) > max
  } catch {
    return true         // 제한 확인 실패 시 인증·메일 요청을 차단합니다
  }
}

/** 성공했으면 그 사람의 실패 기록을 지워 줍니다 */
export async function clearLimit(sql, bucket) {
  try { await sql`DELETE FROM screener_attempt WHERE bucket = ${bucket}` } catch {}
}

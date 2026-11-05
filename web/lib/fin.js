// ============================================================
//  재무제표 보관 열쇠와 읽기
//  · 서버(서울)가 /api/fin/push 로 보내 온 것을 담아 둡니다.
//  · 왜 서버가 받는지는 그 파일의 설명을 보세요.
// ============================================================
export const FIN_KEY = 'dart_fin'

/** 종목코드 하나의 재무. 없으면 null. */
export async function readFin(sql, code) {
  if (!sql) return null
  try {
    const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${FIN_KEY}`
    const v = r[0]?.value?.[code]
    if (!v) return null
    return { ...v, 갱신: r[0].updated_at }
  } catch { return null }
}

/** 여러 종목을 한꺼번에 */
export async function readFinMany(sql, codes) {
  if (!sql || !codes?.length) return {}
  try {
    const r = await sql`SELECT value FROM screener_settings WHERE key = ${FIN_KEY}`
    const all = r[0]?.value || {}
    const out = {}
    for (const c of codes) if (all[c]) out[c] = all[c]
    return out
  } catch { return {} }
}

/* ═══════════════════════════════════════════════════════════
   증권사 리포트 보관함

   왜 파일을 사이트가 받아 두고 서버가 가져가는가
     · 맥에 SSH 키가 없어 서버로 파일을 직접 보낼 수 없습니다.
     · PDF 에서 글자를 뽑는 일은 라이브러리가 필요한데, 그건 서버 쪽이 편합니다.
     · 그래서 사이트가 받아 두고, 서버가 30초마다 물어보러 와 가져갑니다
       (스크리너 수동 실행과 똑같은 방식입니다).

   ※ 리포트 원문은 공개하지 않습니다. 내 보고서를 쓰기 위한 재료로만 씁니다.
   ═══════════════════════════════════════════════════════════ */
export async function ensureReports(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS screener_report (
      id         BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      code       TEXT DEFAULT '',
      name       TEXT DEFAULT '',
      broker     TEXT DEFAULT '',
      day        TEXT DEFAULT '',
      target     NUMERIC,
      opinion    TEXT DEFAULT '',
      filename   TEXT NOT NULL,
      bytes      INTEGER NOT NULL DEFAULT 0,
      pdf        TEXT,                    -- base64. 글자를 뽑고 나면 지웁니다
      status     TEXT NOT NULL DEFAULT 'new',   -- new | doing | done | fail
      note       TEXT DEFAULT '',
      body       TEXT DEFAULT '',         -- 뽑아낸 글자
      points     JSONB                    -- 투자포인트 · 목표주가 등
    )`
  await sql`CREATE INDEX IF NOT EXISTS screener_report_code
            ON screener_report (code, created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS screener_report_status
            ON screener_report (status, id)`
}

export async function ensureScreenerJobs(sql) {
  await sql`CREATE TABLE IF NOT EXISTS screener_job (
    id BIGSERIAL PRIMARY KEY, requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'requested',
    market TEXT NOT NULL DEFAULT 'KR', error TEXT)`
  await sql`ALTER TABLE screener_job ADD COLUMN IF NOT EXISTS market TEXT NOT NULL DEFAULT 'KR'`
  await sql`ALTER TABLE screener_job ADD COLUMN IF NOT EXISTS error TEXT`
  await sql`UPDATE screener_job SET status='failed', finished_at=now(), error='실행 시간이 초과됐습니다. 다시 실행하세요.'
    WHERE status IN ('requested','running') AND requested_at < now() - interval '4 hours'`
  await sql`UPDATE screener_job SET status='failed',finished_at=now(),error='중복 실행 요청을 정리했습니다.'
    WHERE id IN(SELECT id FROM(SELECT id,row_number() OVER(PARTITION BY market ORDER BY requested_at,id) AS n
      FROM screener_job WHERE status IN ('requested','running')) active WHERE n>1)`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS screener_job_active_market ON screener_job(market)
    WHERE status IN ('requested','running')`
}

export async function requestScreening(sql, market) {
  await ensureScreenerJobs(sql)
  return sql`INSERT INTO screener_job(status,market) VALUES('requested',${market})
    ON CONFLICT DO NOTHING
    RETURNING id,market`
}

export async function claimScreening(sql) {
  await ensureScreenerJobs(sql)
  return sql`UPDATE screener_job SET status='running'
    WHERE id=(SELECT id FROM screener_job WHERE status='requested' ORDER BY requested_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id,market`
}

export async function finishScreening(sql, job, market, success, error='') {
  await ensureScreenerJobs(sql)
  return sql`UPDATE screener_job SET status=${success?'done':'failed'},finished_at=now(),error=${success?null:error.slice(0,500)}
    WHERE id=${job} AND market=${market} AND status IN ('requested','running') RETURNING id`
}

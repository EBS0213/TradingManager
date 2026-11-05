// 맥미니의 구독 로그인 Codex가 처리하는 전용 작업함. 일반 방문자는 접근할 수 없다.
import { randomUUID } from 'node:crypto'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'

export async function aiSql() {
  const sql = await getSql()
  await ensureSettings(sql)
  await sql`CREATE TABLE IF NOT EXISTS tm_local_ai_job (
    id uuid PRIMARY KEY, dedupe text UNIQUE NOT NULL, kind text NOT NULL,
    input jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', result jsonb,
    attempts integer NOT NULL DEFAULT 0, token uuid, lease_until timestamptz,
    available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(), error text)`
  return sql
}

export async function enqueueAI(kind, input, dedupe) {
  if (!['brief', 'bofa', 'probe'].includes(kind)) throw new Error('지원하지 않는 작업')
  const sql = await aiSql()
  const rows = await sql`INSERT INTO tm_local_ai_job (id,dedupe,kind,input)
    VALUES (${randomUUID()},${dedupe},${kind},${JSON.stringify(input)}::jsonb)
    ON CONFLICT (dedupe) DO UPDATE SET dedupe=EXCLUDED.dedupe
    RETURNING id,kind,status,created_at`
  return rows[0]
}

export async function claimAI() {
  const sql = await aiSql()
  await sql`INSERT INTO screener_settings (key,value) VALUES ('local_ai_heartbeat',jsonb_build_object('at',now()))
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`
  await sql`UPDATE tm_local_ai_job SET status='failed',error='작업 기한 또는 재시도 한도 초과',updated_at=now()
    WHERE status IN ('pending','running') AND (created_at < now()-interval '1 day'
      OR (attempts >= 3 AND (lease_until IS NULL OR lease_until < now())))`
  const rows = await sql`WITH next AS (
    SELECT id FROM tm_local_ai_job WHERE attempts < 3 AND created_at > now()-interval '1 day'
      AND ((status='pending' AND available_at<=now()) OR (status='running' AND lease_until<now()))
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE tm_local_ai_job j SET status='running',token=${randomUUID()},lease_until=now()+interval '15 minutes',
      attempts=attempts+1,updated_at=now() FROM next WHERE j.id=next.id RETURNING j.*`
  return rows[0] || null
}

// 결과 저장과 작업 완료는 한 SQL문으로 함께 확정한다. 늦게 도착한 이전 실행 결과는 거절한다.
export async function finishAI(id, token, result, target = null, payload = null) {
  const sql = await aiSql()
  const encoded = JSON.stringify(result)
  if (!target) {
    return (await sql`UPDATE tm_local_ai_job SET status='done',result=${encoded}::jsonb,updated_at=now()
      WHERE id=${id}::uuid AND token=${token}::uuid AND status='running' AND lease_until>now() RETURNING id`)[0]
  }
  const rows = await sql`WITH owned AS (
      SELECT id FROM tm_local_ai_job WHERE id=${id}::uuid AND token=${token}::uuid
        AND status='running' AND lease_until>now() FOR UPDATE),
    saved AS (
      INSERT INTO screener_settings (key,value,updated_at)
      SELECT ${target},${JSON.stringify(payload)}::jsonb,now() FROM owned
      ON CONFLICT (key) DO UPDATE SET value=CASE WHEN EXCLUDED.key='brief_log' THEN
        jsonb_build_object('items',jsonb_path_query_array(
          (EXCLUDED.value->'items') || COALESCE((SELECT jsonb_agg(item)
            FROM jsonb_array_elements(COALESCE(screener_settings.value->'items','[]'::jsonb)) AS item
            WHERE item->>'day' IS DISTINCT FROM EXCLUDED.value->'items'->0->>'day'
              OR item->>'slot' IS DISTINCT FROM EXCLUDED.value->'items'->0->>'slot'), '[]'::jsonb), '$[0 to 29]'))
        ELSE EXCLUDED.value END, updated_at=now() RETURNING key)
    UPDATE tm_local_ai_job SET status='done',result=${encoded}::jsonb,updated_at=now()
      WHERE id IN (SELECT id FROM owned) AND EXISTS (SELECT 1 FROM saved) RETURNING id`
  return rows[0]
}

export async function failAI(id, token, quota) {
  const sql = await aiSql()
  return (await sql`UPDATE tm_local_ai_job SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,
    error=${quota ? 'Codex 구독 한도 — 대기' : '맥미니 작성 실패'},token=NULL,lease_until=NULL,
    available_at=now()+(${quota ? 3600 : 600}*interval '1 second'),updated_at=now()
    WHERE id=${id}::uuid AND token=${token}::uuid AND status='running' RETURNING id`)[0]
}

export async function localAIStatus() {
  const sql = await aiSql()
  const heartbeat = (await sql`SELECT value FROM screener_settings WHERE key='local_ai_heartbeat'`)[0]?.value || null
  const jobs = await sql`SELECT id,kind,status,attempts,created_at,updated_at,error FROM tm_local_ai_job
    ORDER BY created_at DESC LIMIT 20`
  return { provider: 'local-codex-subscription', heartbeat, jobs }
}

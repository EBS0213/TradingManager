import {getSql} from '@/lib/db'
import {ensureTables} from '@/lib/auth'
import {hash} from './core.mjs'
let ready
export async function store(){
 const sql=await getSql()
 if(!ready) ready=(async()=>{
 await ensureTables(sql)
 await sql`CREATE TABLE IF NOT EXISTS tm_chat_worker (id text PRIMARY KEY, token_hash text UNIQUE NOT NULL, seen_at timestamptz, enabled boolean NOT NULL DEFAULT true)`
 await sql`CREATE TABLE IF NOT EXISTS tm_chat_job (id uuid PRIMARY KEY, owner text NOT NULL, question text NOT NULL, context jsonb NOT NULL, status text NOT NULL DEFAULT 'queued', slot int NOT NULL, answer text, error text, lease uuid, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz)`
 await sql`ALTER TABLE tm_chat_job ADD COLUMN IF NOT EXISTS user_id bigint REFERENCES screener_user(id) ON DELETE CASCADE`
 await sql`CREATE INDEX IF NOT EXISTS tm_chat_history ON tm_chat_job(owner,created_at DESC,id DESC)`
 await sql`CREATE UNIQUE INDEX IF NOT EXISTS tm_chat_slot ON tm_chat_job(slot) WHERE status IN ('queued','running')`
 await sql`CREATE UNIQUE INDEX IF NOT EXISTS tm_chat_owner_active ON tm_chat_job(owner) WHERE status IN ('queued','running')`
 await sql`CREATE TABLE IF NOT EXISTS tm_chat_quota (bucket text PRIMARY KEY, uses int NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL)`
 })().catch(e=>{ready=null;throw e})
 await ready;return sql
}
export async function online(sql){const r=await sql`SELECT id FROM tm_chat_worker WHERE enabled AND seen_at>now()-interval '90 seconds' LIMIT 1`;return r.length>0}
export async function cleanup(sql){
 await sql`UPDATE tm_chat_job SET status='error',error='응답 시간이 초과되었습니다. 다시 질문해주세요.',finished_at=now() WHERE (status='running' AND lease_until<now()) OR (status='queued' AND created_at<now()-interval '20 minutes')`
 await sql`DELETE FROM tm_chat_job WHERE user_id IS NULL AND created_at<now()-interval '24 hours'`
 await sql`DELETE FROM tm_chat_quota WHERE expires_at<now()`
}
export async function worker(sql,request){
 const token=(request.headers.get('authorization')||'').match(/^Bearer ([a-f0-9]{64})$/)?.[1]
 const expected=process.env.TM26_CHAT_WORKER_TOKEN
 if(!token||!expected||hash(token)!==hash(expected))return null
 const r=await sql`INSERT INTO tm_chat_worker(id,token_hash) VALUES('local-primary',${hash(token)}) ON CONFLICT(id) DO UPDATE SET token_hash=EXCLUDED.token_hash RETURNING id,enabled`
 return r[0]?.enabled?r[0].id:null
}
export async function quota(sql,bucket,limit){
 const r=await sql`INSERT INTO tm_chat_quota(bucket,uses,expires_at) VALUES(${bucket},1,now()+interval '2 hours') ON CONFLICT(bucket) DO UPDATE SET uses=tm_chat_quota.uses+1 WHERE tm_chat_quota.uses<${limit} RETURNING uses`
 return r.length>0
}

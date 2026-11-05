// 표를 만듭니다.  실행:  npm run db:init
import { getSql } from '../lib/db.js'
const sql = await getSql()

await sql`
  CREATE TABLE IF NOT EXISTS screener_snapshot (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    stamp TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'aws',
    rows INTEGER NOT NULL DEFAULT 0,
    passed INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL
  )`
await sql`CREATE INDEX IF NOT EXISTS screener_snapshot_created ON screener_snapshot (created_at DESC)`
await sql`
  CREATE TABLE IF NOT EXISTS screener_watchlist (
    code TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    memo TEXT DEFAULT '',
    added_on TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`
await sql`
  CREATE TABLE IF NOT EXISTS screener_job (
    id BIGSERIAL PRIMARY KEY,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'requested'
  )`
await sql`
  CREATE TABLE IF NOT EXISTS screener_heartbeat (
    id INTEGER PRIMARY KEY,
    beat_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`
console.log('✓ 표 준비 완료 (snapshot / watchlist / job / heartbeat)')
process.exit(0)

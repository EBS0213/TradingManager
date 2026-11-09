import { seedContent } from './seed-content.mjs'
// 표를 만듭니다.  실행:  npm run db:init
import { getSql } from '../lib/db.js'
import { seedScreener } from './seed-screener.mjs'
import { seedSectorHistory } from './seed-sector-history.mjs'
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
await sql`ALTER TABLE screener_snapshot ADD COLUMN IF NOT EXISTS market TEXT NOT NULL DEFAULT 'KR'`
await sql`ALTER TABLE screener_job ADD COLUMN IF NOT EXISTS market TEXT NOT NULL DEFAULT 'KR'`
await sql`CREATE INDEX IF NOT EXISTS screener_snapshot_market ON screener_snapshot (market, created_at DESC)`
await seedScreener(sql)
await sql`CREATE TABLE IF NOT EXISTS screener_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`
await seedSectorHistory(sql)
await seedContent()
console.log('✓ 표 및 초기 스크리닝 결과 준비 완료')
process.exit(0)

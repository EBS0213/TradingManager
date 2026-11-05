import { once } from '@/lib/once'
// 사이트 설정값 보관 (지금은 운영 비용 표만 씁니다)
async function _ensureSettings(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS screener_settings (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
}

/* 스크리닝 결과 표에 '어느 시장인지' 칸을 더합니다.
   이미 있으면 아무 일도 하지 않습니다. 예전에 쌓인 결과는 전부 한국(KR)으로 봅니다. */
async function _ensureMarketColumn(sql) {
  await sql`
    ALTER TABLE screener_snapshot
    ADD COLUMN IF NOT EXISTS market TEXT NOT NULL DEFAULT 'KR'`
  await sql`
    CREATE INDEX IF NOT EXISTS screener_snapshot_market
    ON screener_snapshot (market, created_at DESC)`
}

/* 한 번만 하면 되는 준비입니다 — 자세한 까닭은 lib/once.js 를 보세요.
   (2026-08-27: 게시판 목록 한 번에 Neon 을 18번 오가던 것을 3번으로 줄였습니다) */
export const ensureSettings = once('settings', _ensureSettings)
export const ensureMarketColumn = once('marketcol', _ensureMarketColumn)

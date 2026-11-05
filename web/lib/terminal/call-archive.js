import { once } from '@/lib/once'
import { ensureSettings } from '@/lib/settings'

// Import the existing JSON store once, then keep each quarter as an individual row.
export const ensureCallArchive = once('call-archive', async (sql) => {
  await ensureSettings(sql)
  await sql`
    CREATE TABLE IF NOT EXISTS conference_call_archive (
      code TEXT NOT NULL,
      quarter TEXT NOT NULL,
      call_date TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (code, quarter)
    )`
  await sql`
    INSERT INTO conference_call_archive (code, quarter, call_date, payload, updated_at)
    SELECT item->>'code', COALESCE(item->>'quarter', ''), COALESCE(item->>'date', ''), item, settings.updated_at
    FROM screener_settings AS settings
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(settings.value->'items') = 'array'
        THEN settings.value->'items' ELSE '[]'::jsonb END
    ) AS source(item)
    WHERE settings.key = 'conf_calls' AND COALESCE(item->>'code', '') <> ''
    ON CONFLICT (code, quarter) DO NOTHING`
})

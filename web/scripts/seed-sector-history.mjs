import fs from 'node:fs/promises'
import {mergeSectorHistory} from '../lib/sector-history.mjs'

export async function seedSectorHistory(sql) {
  const data = JSON.parse(await fs.readFile(new URL('../../seed/screener/sector-history.json',import.meta.url),'utf8'))
  if (data.version !== 1) throw new Error('Unsupported sector history seed')
  for (const market of ['KR','US']) {
    const key = `sector_hist_${market}`
    const existing = await sql`SELECT value FROM screener_settings WHERE key = ${key}`
    const list = mergeSectorHistory(data.markets[market] || [], existing[0]?.value?.list || [])
    const value = JSON.stringify({list})
    await sql`INSERT INTO screener_settings (key,value,updated_at) VALUES (${key},${value}::jsonb,now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
    console.log(`${market}: ${list.length} daily sector observations restored`)
  }
}

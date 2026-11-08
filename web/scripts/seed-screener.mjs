import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {gunzipSync} from 'node:zlib'

export async function readSeeds(directory = new URL('../../seed/screener/', import.meta.url)) {
  const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', directory), 'utf8'))
  if (manifest.version !== 1) throw new Error('Unsupported screener seed version')
  const seeds = []
  for (const [market, entry] of Object.entries(manifest.markets)) {
    if (!['KR', 'US'].includes(market) || entry.file !== `${market.toLowerCase()}.json.gz`)
      throw new Error('Invalid seed market or filename')
    const compressed = await fs.readFile(new URL(entry.file, directory))
    if (createHash('sha256').update(compressed).digest('hex') !== entry.sha256)
      throw new Error(`${market}: seed checksum mismatch`)
    const data = JSON.parse(gunzipSync(compressed, {maxOutputLength: 64 * 1024 * 1024}))
    if (data.version !== 1 || data.market !== market || !data.stamp || data.stamp !== entry.stamp
        || !Array.isArray(data.result) || !data.result.length || data.result.length !== entry.rows
        || data.result.some(row => !row['코드'] || !row['종목명']))
      throw new Error(`${market}: invalid screener seed`)
    seeds.push(data)
  }
  if (!seeds.length) throw new Error('No installation screening data')
  return seeds
}

// Install only into an empty market. Updating/reinstalling never replaces local results.
export async function seedScreener(sql, seeds) {
  seeds ??= await readSeeds()
  for (const data of seeds) {
    const main = data.result.filter(row => !row['제외사유'])
    const inserted = await sql`
      INSERT INTO screener_snapshot (stamp, source, rows, passed, payload, market)
      SELECT ${data.stamp}, 'installation-seed', ${main.length},
             ${main.filter(row => row['판정'] === '통과').length}, ${JSON.stringify(data.result)}, ${data.market}
      WHERE NOT EXISTS (SELECT 1 FROM screener_snapshot WHERE market = ${data.market})
      RETURNING id`
    console.log(`${data.market}: ${inserted.length ? `${data.result.length} initial rows installed (${data.stamp})` : 'existing results preserved'}`)
  }
}

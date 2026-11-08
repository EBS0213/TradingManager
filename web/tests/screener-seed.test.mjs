import assert from 'node:assert/strict'
import {test} from 'node:test'
import pg from 'pg'
import {readSeeds, seedScreener} from '../scripts/seed-screener.mjs'

test('bundled results have real rows and contain no personal watchlists', async () => {
  for (const seed of await readSeeds()) {
    assert.ok(seed.result.length > 0)
    assert.equal(seed.watchlist, undefined)
    assert.ok(seed.result.every(row => !('관심' in row) && !('memo' in row) && !('email' in row)))
  }
})

test('fresh installation, reinstall and existing market preservation', {skip: !process.env.DATABASE_URL}, async () => {
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  const client = new pg.Client({connectionString: process.env.DATABASE_URL})
  await client.connect()
  try {
    // Session-local temporary table shadows the real application table.
    await client.query(`CREATE TEMP TABLE screener_snapshot (
      id bigserial, stamp text, source text, rows integer, passed integer, payload text, market text)`)
    const sql = async (parts, ...values) => (await client.query(
      parts.map((part, i) => part + (i < values.length ? `$${i + 1}` : '')).join(''), values)).rows
    const seeds = await readSeeds()
    await seedScreener(sql, seeds)
    await seedScreener(sql, seeds)
    assert.equal((await client.query('SELECT * FROM screener_snapshot')).rowCount, seeds.length)
    await client.query("UPDATE screener_snapshot SET stamp='user-result',payload='[]'")
    await seedScreener(sql, seeds)
    const preserved = (await client.query('SELECT * FROM screener_snapshot')).rows
    assert.ok(preserved.every(row => row.stamp === 'user-result' && row.payload === '[]'))
  } finally {
    await client.end()
  }
})

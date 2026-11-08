import test from 'node:test'
import assert from 'node:assert/strict'
import {createSqlAccessor} from '../lib/db.js'
const local = () => 'postgresql://tm26:secret@127.0.0.1:55426/tm26'

test('simultaneous cold requests share exactly one pool initialization', async () => {
  let calls = 0, resolve
  const sql = () => []
  const getSql = createSqlAccessor(() => { calls++; return new Promise(r => { resolve = r }) }, local)
  const requests = Array.from({length: 30}, () => getSql())
  await Promise.resolve()
  assert.equal(calls, 1)
  resolve(sql)
  const values = await Promise.all(requests)
  assert(values.every(value => value === sql))
  assert.equal(await getSql(), sql)
  assert.equal(calls, 1)
})

test('failed initialization is retried without permanently caching a rejection', async () => {
  let calls = 0
  const sql = () => []
  const getSql = createSqlAccessor(() => { if (++calls === 1) throw Error('temporary'); return sql }, local)
  const first = await Promise.allSettled([getSql(), getSql()])
  assert(first.every(result => result.status === 'rejected'))
  assert.equal(calls, 1)
  assert.equal(await getSql(), sql)
  assert.equal(calls, 2)
})

test('remote and non-PostgreSQL URLs are rejected before driver initialization', async () => {
  for (const url of ['postgresql://user:secret@external.test/db', 'https://127.0.0.1/db', '']) {
    let calls = 0
    const getSql = createSqlAccessor(() => calls++, () => url)
    await assert.rejects(getSql())
    assert.equal(calls, 0)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { getLocalOwner, isLocalOwnerRequest } from '../lib/local-owner.mjs'

test('only explicit local mode and same-origin loopback requests use the owner', () => {
  for (const host of ['127.0.0.1:8766', 'localhost:8766', '[::1]:8766']) {
    const h = new Headers({ host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' })
    assert.equal(isLocalOwnerRequest(h, '1'), true)
    assert.equal(isLocalOwnerRequest(h, undefined), false)
    assert.equal(isLocalOwnerRequest(new Headers({ host }), '1'), true)
  }
  for (const headers of [
    { host: 'evil.example', 'x-forwarded-host': '127.0.0.1:8766' },
    { host: '127.0.0.1.evil.example' },
    { host: '127.0.0.1:8766', origin: 'https://evil.example' },
    { host: '127.0.0.1:8766', origin: 'null' },
    { host: '127.0.0.1:8766', 'sec-fetch-site': 'cross-site' },
    { host: 'localhost:8766', origin: 'http://127.0.0.1:8766' },
  ]) assert.equal(isLocalOwnerRequest(new Headers(headers), '1'), false)
})

test('existing desktop and automation owner is reused without modifying records or password', async () => {
  const calls = []
  const owner = { id: '7', email: 'owner@example.test', role: 'admin', verified: true, nickname: 'Owner' }
  const sql = async (strings) => { calls.push(strings.join('?')); return [owner] }
  assert.deepEqual(await getLocalOwner(sql, () => { throw Error('must not rehash') }), { ...owner, local: true })
  assert.equal(calls.length, 1)
  assert.match(calls[0], /ORDER BY id LIMIT 1/)
})

test('a fresh installation provisions a local owner with conflict-safe insertion', async () => {
  const calls = []
  const sql = async (strings, ...values) => {
    calls.push({ query: strings.join('?'), values })
    return calls.length === 1 ? [] : [{ id: '1', role: 'admin' }]
  }
  assert.equal((await getLocalOwner(sql, () => 'random-password-hash')).local, true)
  assert.match(calls[1].query, /ON CONFLICT \(email\)/)
  assert.deepEqual(calls[1].values, ['random-password-hash'])
})

const source = fs.readFileSync(new URL('../lib/auth.js', import.meta.url), 'utf8')
const start = source.indexOf('export async function currentUser()')
const end = source.indexOf('export async function requireUser()', start)
const currentUserSource = source.slice(start, end).replace('export async function', 'async function')

test('currentUser opens local features without reading a login cookie', async () => {
  const context = {
    process: { env: { TM26_LOCAL_ONLY: '1' } },
    headers: async () => new Headers({ host: '127.0.0.1:8766' }),
    isLocalOwnerRequest: h => isLocalOwnerRequest(h, '1'),
    getSql: async () => ({}), ensureTables: async () => {},
    getLocalOwner: async () => ({ id: '1', local: true, role: 'admin' }),
    cookies: async () => { throw Error('login cookie must not be needed') },
  }
  vm.createContext(context)
  vm.runInContext(currentUserSource, context)
  assert.equal((await context.currentUser()).local, true)
  context.headers = async () => new Headers({ host: 'public.example' })
  assert.equal(await context.currentUser(), null)
})

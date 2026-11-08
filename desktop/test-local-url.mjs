import test from 'node:test'
import assert from 'node:assert/strict'
import {localUrl} from './local-url.mjs'
test('workers accept a configured loopback port', () => {
  assert.equal(localUrl('http://127.0.0.1:18766').origin,'http://127.0.0.1:18766')
})
test('workers reject remote, credential-bearing, and path-bearing destinations', () => {
  for (const value of ['https://evil.test','http://127.0.0.1.evil.test:8766','http://user@127.0.0.1:8766','http://127.0.0.1:8766/path','http://127.0.0.1:8766?secret=key']) {
    assert.throws(() => localUrl(value))
  }
})

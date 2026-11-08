import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {saveJson, readJson, catalog} from '../lib/local-market.mjs'

test('same-millisecond cache writes remain atomic and leave no temporary files', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'tm-cache-'))
  const now = Date.now
  try {
    Date.now = () => 1234
    const file = path.join(folder,'quotes.json')
    await Promise.all(Array.from({length: 40}, (_,id) => saveJson(file,{id,rows:[1,2,3]})))
    const saved = await readJson(file)
    assert.equal(saved.id,39)
    assert.deepEqual(saved.rows,[1,2,3])
    assert.deepEqual(await fs.readdir(folder),['quotes.json'])
  } finally {Date.now = now; await fs.rm(folder,{recursive:true,force:true})}
})

test('a failed cache write preserves the old value and does not block the next writer', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'tm-cache-failure-'))
  try {
    const file = path.join(folder,'quotes.json')
    await saveJson(file,{id:'previous'})
    const circular = {}; circular.self = circular
    const failed = saveJson(file,circular)
    const rejection = assert.rejects(failed,TypeError)
    await rejection
    assert.deepEqual(await readJson(file),{id:'previous'})
    const results = await Promise.allSettled([saveJson(file,circular),saveJson(file,{id:'next'})])
    assert.equal(results[0].status,'rejected')
    assert.equal(results[1].status,'fulfilled')
    assert.deepEqual(await readJson(file),{id:'next'})
    assert.deepEqual(await fs.readdir(folder),['quotes.json'])
  } finally { await fs.rm(folder,{recursive:true,force:true}) }
})

test('Windows file locks are retried without deleting the previous cache', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'tm-cache-lock-'))
  const platform = Object.getOwnPropertyDescriptor(process,'platform')
  const rename = fs.rename.bind(fs)
  try {
    const file = path.join(folder,'quotes.json')
    await saveJson(file,{id:'previous'})
    Object.defineProperty(process,'platform',{...platform,value:'win32'})
    let attempts = 0
    const replacement = t.mock.method(fs,'rename',async (...args) => {
      assert.deepEqual(await readJson(file),{id:'previous'})
      if (++attempts <= 2) throw Object.assign(new Error('sharing violation'),{code:'EPERM'})
      return rename(...args)
    })
    await saveJson(file,{id:'next'})
    assert.equal(attempts,3)
    replacement.mock.restore()
    assert.deepEqual(await readJson(file),{id:'next'})
    assert.deepEqual(await fs.readdir(folder),['quotes.json'])
  } finally {
    t.mock.restoreAll()
    Object.defineProperty(process,'platform',platform)
    await fs.rm(folder,{recursive:true,force:true})
  }
})

test('permanent Windows replacement failures are bounded and clean up their temporary file', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'tm-cache-denied-'))
  const platform = Object.getOwnPropertyDescriptor(process,'platform')
  try {
    const file = path.join(folder,'quotes.json')
    await saveJson(file,{id:'previous'})
    Object.defineProperty(process,'platform',{...platform,value:'win32'})
    const replacement = t.mock.method(fs,'rename',async () => {
      throw Object.assign(new Error('access denied'),{code:'EACCES'})
    })
    await assert.rejects(saveJson(file,{id:'blocked'}),{code:'EACCES'})
    assert.equal(replacement.mock.callCount(),8)
    assert.deepEqual(await readJson(file),{id:'previous'})
    assert.deepEqual(await fs.readdir(folder),['quotes.json'])
    replacement.mock.restore()
    await saveJson(file,{id:'recovered'})
    assert.deepEqual(await readJson(file),{id:'recovered'})
  } finally {
    t.mock.restoreAll()
    Object.defineProperty(process,'platform',platform)
    await fs.rm(folder,{recursive:true,force:true})
  }
})

test('concurrent cold catalog requests share one provider download', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'tm-catalog-'))
  const previous = process.env.TM26_LOCAL_DATA, fetcher = globalThis.fetch
  let calls = 0
  try {
    process.env.TM26_LOCAL_DATA = folder
    globalThis.fetch = async () => {
      calls++
      await new Promise(resolve => setTimeout(resolve,30))
      const rows = Array.from({length:1001},(_,i)=>`N|A${i}|Company ${i}|N|Q`)
      return {ok:true,text:async()=>['Test Issue|Symbol|Security Name|ETF|Listing Exchange',...rows].join('\n')}
    }
    const results = await Promise.all(Array.from({length:20},()=>catalog()))
    assert.equal(calls,1)
    assert(results.every(items=>items.length===1001))
    await catalog()
    assert.equal(calls,1)
  } finally {
    globalThis.fetch = fetcher
    if(previous===undefined)delete process.env.TM26_LOCAL_DATA;else process.env.TM26_LOCAL_DATA=previous
    await fs.rm(folder,{recursive:true,force:true})
  }
})

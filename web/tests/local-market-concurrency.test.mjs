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
    assert(Number.isInteger(saved.id))
    assert.deepEqual(saved.rows,[1,2,3])
    assert.deepEqual(await fs.readdir(folder),['quotes.json'])
  } finally {Date.now = now; await fs.rm(folder,{recursive:true,force:true})}
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

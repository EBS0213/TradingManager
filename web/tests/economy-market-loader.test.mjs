import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

const dataModule = new URL('../lib/terminal/economy-market-data.mjs',import.meta.url).href
const source = (await readFile(new URL('../lib/terminal/economy-market.js',import.meta.url),'utf8'))
  .replace("import { getSql } from '@/lib/db'",'const getSql=()=>{throw new Error("No database in provider test")}')
  .replace("import { readPushed } from '@/lib/macrofeed'",'const readPushed=()=>null')
  .replace("'./economy-market-data.mjs'",JSON.stringify(dataModule))
const {getMarketEconomy} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

test('public commodity categories share the four-request ceiling and failed categories stay unavailable',async()=>{
  const originalFetch = globalThis.fetch
  const requests = []
  let active = 0, maximum = 0
  globalThis.fetch = async (url,options) => {
    requests.push(String(url))
    assert.ok(options.signal instanceof AbortSignal)
    assert.equal(options.cache,'no-store')
    active++; maximum=Math.max(maximum,active)
    await new Promise(resolve=>setTimeout(resolve,5))
    active--
    if(String(url).endsWith('/agricultural'))return new Response('unavailable',{status:503})
    if(String(url).endsWith('/metals'))return Response.json([
      {reutersCode:'SIcv1',unit:'USD/OZS',closePrice:'56.91',localTradedAt:new Date().toISOString()},
      {reutersCode:'HGcv1',unit:'USD/LBS',closePrice:'6.5160',localTradedAt:new Date().toISOString()},
    ])
    if(String(url).endsWith('/energy'))return Response.json([
      {reutersCode:'NGcv1',unit:'USD/MMBTU',closePrice:'2.79',localTradedAt:new Date().toISOString(),priceDataType:'CLOSING_PRICE'},
    ])
    return Response.json([])
  }
  try {
    const result = await getMarketEconomy()
    assert.equal(requests.length,7)
    assert.equal(new Set(requests).size,7)
    assert.equal(maximum,4)
    assert.equal(result.series.find(r=>r.id==='NAVER:SIcv1').value,56.91)
    assert.equal(result.series.find(r=>r.id==='NAVER:HGcv1').value,6.516)
    assert.equal(result.series.find(r=>r.id==='NAVER:NGcv1').value,2.79)
    for(const code of ['Ccv1','Wcv1','Scv1']) {
      const row=result.series.find(r=>r.id===`NAVER:${code}`)
      assert.equal(row.status,'unavailable')
      assert.equal(row.value,null)
      assert.equal(row.asOf,null)
    }
    assert.ok(result.errors.some(error=>error.includes('농축산물')))
  } finally {globalThis.fetch=originalFetch}
})

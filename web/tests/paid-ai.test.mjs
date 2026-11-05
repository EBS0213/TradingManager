import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../lib/ai.js',import.meta.url),'utf8').replace(/^import .*$/mg,'').replaceAll('export const ','const ').replaceAll('export async function ','async function ')
test('paid AI makes no network call unless this installation opts in with its own key',async()=>{
 for(const env of [{},{ANTHROPIC_API_KEY:'fixture-not-a-real-key'},{TM26_PAID_AI_ENABLED:'1'}]){
  let calls=0;const api=vm.runInNewContext(source+'\n;({hasAI,writeText})',{process:{env},fetch:()=>{calls++;throw Error('Unexpected paid call')}})
  assert.equal(api.hasAI(),false);assert.equal(await api.writeText({system:'test',prompt:'test'}),null);assert.equal(calls,0)
 }
 const api=vm.runInNewContext(source+'\n;({hasAI})',{process:{env:{TM26_PAID_AI_ENABLED:'1',ANTHROPIC_API_KEY:'installation-owned-key'}}})
 assert.equal(api.hasAI(),true)
})

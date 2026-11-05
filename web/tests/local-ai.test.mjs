import test from 'node:test'
import assert from 'node:assert/strict'
import { bofaResult, briefText } from '../lib/local-ai-validation.mjs'
const now=Date.parse('2026-10-19T12:00:00Z')
const good={value:5.2,prev:null,date:'2026-10-16',source:'https://example.org/report',title:'검증 자료'}
test('null is missing, never a zero value',()=>assert.equal(bofaResult({value:null},now),null))
test('valid BofA result preserves source date and null previous',()=>{const r=bofaResult(good,now);assert.equal(r.prev,null);assert.equal(r.at,'2026-10-16T00:00:00.000Z')})
test('reject stale future or impossible dates and values',()=>{
 for(const patch of [{date:'2026-09-01'},{date:'2026-10-20'},{date:'2026-02-30'},{value:'5.2'},{value:11},{prev:-1},{source:'javascript:alert(1)'},{title:''}])
  assert.throws(()=>bofaResult({...good,...patch},now))
})
test('briefs must be complete and cannot contain active HTML',()=>{
 assert.throws(()=>briefText({text:'짧음'}));assert.throws(()=>briefText({text:'a'.repeat(500)+'<script>bad</script>'}))
 assert.equal(briefText({text:'<b>제목</b>'+ '본문 '.repeat(200)}).startsWith('<b>'),true)
})

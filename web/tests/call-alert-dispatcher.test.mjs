import test from 'node:test'
import assert from 'node:assert/strict'
import {createCallAlertDispatcher} from '../lib/terminal/call-alert-dispatcher.mjs'

const full={code:'WDC',name:'웨스턴디지털',quarter:'2027 회계연도 1분기',summary:'실적 요약',call:'발표 및 질의응답',
  pipeline:{id:'foolcalls-codex-v1'},documents:{sha256:'source',translation:{sourceSha256:'source'}}}
function setup({rules={enabled:true,kind:'symbols',symbols:['WDC']},time='2026-10-23T07:10:00Z',fail=false}={}){
  const rows=new Map();let sent=0;let current=new Date(time)
  const store={
    rules:async()=>rules,
    async enqueue(key,payload,due){if(rows.has(key))return false;rows.set(key,{key,payload,due,status:'pending'});return true},
    ready:async now=>[...rows.values()].filter(row=>row.status==='pending'&&row.due<=now),
    async claim(key){const row=rows.get(key);if(row.status!=='pending')return false;row.status='sending';return true},
    async skip(key){rows.get(key).status='skipped'},
    async sent(key,id){Object.assign(rows.get(key),{status:'sent',id})},
    async uncertain(key){rows.get(key).status='uncertain'},
  }
  const dispatcher=createCallAlertDispatcher({store,now:()=>current,send:async()=>{sent++;if(fail)throw Error('lost acknowledgement');return {ok:true,result:{message_id:37}}}})
  return {dispatcher,rows,sent:()=>sent,setTime:value=>{current=new Date(value)}}
}
test('only completed matching documents enter the outbox; one company and fiscal period send once',async()=>{
  const ctx=setup()
  assert.equal((await ctx.dispatcher.enqueue([{...full,documents:null},{...full,documents:{sha256:'other',translation:{sourceSha256:'source'}}}])).queued,0)
  assert.equal((await ctx.dispatcher.enqueue([full,full])).queued,1)
  assert.equal((await ctx.dispatcher.flush()).sent,1)
  await ctx.dispatcher.enqueue([full]);await ctx.dispatcher.flush()
  assert.equal(ctx.sent(),1);assert.equal(ctx.rows.get('WDC:2027Q1').payload.documents,undefined)
})
test('quiet-hour completion waits until five minutes past the next hour',async()=>{
  const ctx=setup({time:'2026-10-23T07:58:00Z'})
  await ctx.dispatcher.enqueue([full])
  assert.equal((await ctx.dispatcher.flush()).deferred,true);assert.equal(ctx.sent(),0)
  ctx.setTime('2026-10-23T08:05:00Z')
  assert.equal((await ctx.dispatcher.flush()).sent,1)
})
test('missing eligibility leaves completed companies pending without sending',async()=>{
  const ctx=setup({rules:null});await ctx.dispatcher.enqueue([full])
  assert.equal((await ctx.dispatcher.flush()).waitingRules,true)
  assert.equal(ctx.rows.get('WDC:2027Q1').status,'pending');assert.equal(ctx.sent(),0)
})
test('concurrent dispatchers cannot send the same claimed company twice',async()=>{
  const ctx=setup();await ctx.dispatcher.enqueue([full])
  await Promise.all([ctx.dispatcher.flush(),ctx.dispatcher.flush()]);assert.equal(ctx.sent(),1)
})
test('lost acknowledgements do not automatically resend and duplicate a message',async()=>{
  const ctx=setup({fail:true});await ctx.dispatcher.enqueue([full])
  assert.equal((await ctx.dispatcher.flush()).uncertain,1)
  await ctx.dispatcher.flush();assert.equal(ctx.sent(),1)
  assert.equal(ctx.rows.get('WDC:2027Q1').status,'uncertain')
})
test('companies outside the existing configured target list are skipped',async()=>{
  const ctx=setup({rules:{enabled:true,kind:'symbols',symbols:['NEM']}})
  await ctx.dispatcher.enqueue([full]);assert.equal((await ctx.dispatcher.flush()).skipped,1);assert.equal(ctx.sent(),0)
})

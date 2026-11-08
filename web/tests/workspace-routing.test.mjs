import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {selectionFromHash,selectionForPage,acceptFramePage,safeReturnPath,nativePages,tradingPages} from '../lib/workspace-routing.mjs'

test('areas stay separated and existing/deep links keep their destination',()=>{
  assert.deepEqual(selectionFromHash(''),{area:'terminal',page:'overview'})
  for (const page of nativePages) assert.deepEqual(selectionFromHash('#terminal/'+page),{area:tradingPages.has(page)?'trading':'terminal',page})
  assert.deepEqual(selectionFromHash('#terminal/log'),{area:'trading',page:'log'})
  assert.deepEqual(selectionFromHash('#trading/market'),{area:'terminal',page:'overview'})
  assert.deepEqual(selectionFromHash('#terminal/data'),{area:'terminal',page:'data'})
  assert.deepEqual(selectionFromHash('#terminal/find'),{area:'terminal',page:'equities'})
  assert.deepEqual(selectionFromHash('#terminal/index'),{area:'terminal',page:'overview'})
  assert.deepEqual(selectionFromHash('#terminal/macro'),{area:'terminal',page:'data'})
  assert.deepEqual(selectionFromHash('#terminal/calendar'),{area:'terminal',page:'calls'})
  assert.deepEqual(selectionFromHash('#research/123'),{area:'terminal',page:'research/123'})
  assert.deepEqual(selectionFromHash('#terminal/board/12'),{area:'terminal',page:'research/12'})
  assert.deepEqual(selectionFromHash('',{area:'trading',page:'training'}),{area:'trading',page:'training'})
  for(const value of ['research/12/evil','board/0','board/9007199254740992','log/13','//evil','research/<script>'])assert.equal(selectionForPage(value),null)
})
test('hidden frames, passive renders, and responses from a previous navigation cannot move the workspace',()=>{
  const event={type:'tm-workspace-page',navigation:'push',requestId:3,page:'research/12'}
  for(const page of nativePages) assert.equal(acceptFramePage(event,{area:'terminal',page},3),null)
  assert.equal(acceptFramePage(event,{area:'terminal',page:'market'},3),null)
  assert.equal(acceptFramePage(event,{area:'terminal',page:'data'},3),null)
  assert.equal(acceptFramePage(event,{area:'trading',page:'log'},4),null)
  assert.equal(acceptFramePage({...event,navigation:'replace'},{area:'trading',page:'log'},3),null)
  assert.equal(acceptFramePage(event,{area:'terminal',page:'research'},3),null)
  assert.equal(acceptFramePage(event,{area:'terminal',page:'research/99'},3),null)
  assert.equal(acceptFramePage(event,{area:'terminal',page:'board'},3),null)
  assert.deepEqual(acceptFramePage(event,{area:'terminal',page:'us'},3),{area:'terminal',page:'research/12'})
})
test('login return links preserve workspace state and reject external redirects',()=>{
  assert.equal(safeReturnPath('/screener?view=all#terminal/research/123'),'/screener?view=all#terminal/research/123')
  for(const value of ['https://evil.example','//evil.example','/\\evil.example','/\n/evil.example',null])assert.equal(safeReturnPath(value),'/')
})
const html=fs.readFileSync(new URL('../public/screener/app.html',import.meta.url),'utf8')
function extract(start,end){return html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)))}
test('embedded passive rendering never takes ownership of parent history',()=>{
  const sent=[],replaced=[]
  const context={window:{__TM_WORKSPACE:true,__TM_WORKSPACE_VISIBLE:true,__TM_WORKSPACE_REQUEST:7,parent:{postMessage:(...args)=>sent.push(args)}},history:{replaceState:(_,__,hash)=>replaced.push(hash)},location:{origin:'https://tm26.test'}}
  vm.createContext(context);vm.runInContext(extract('function markURL(hash, push){','\nfunction go(page, opts){'),context)
  context.markURL('log',false)
  assert.equal(sent[0][0].navigation,'replace');assert.equal(sent[0][0].requestId,7)
  context.window.__TM_WORKSPACE_VISIBLE=false;context.markURL('research',true)
  assert.equal(sent.length,1);assert.equal(replaced.at(-1),'#research')
})
test('legacy login action returns to the exact top-level deep post',()=>{
  const target={origin:'https://tm26.test',pathname:'/screener',search:'',hash:'#terminal/research/123',href:''}
  const context={window:{top:{location:target}},location:{origin:'https://tm26.test'},encodeURIComponent}
  vm.createContext(context);vm.runInContext(extract('function goLogin(mode){','\n/* ═══════ 데이터 적재'),context)
  context.goLogin()
  assert.equal(new URL(target.href,'https://tm26.test').searchParams.get('next'),'/screener#terminal/research/123')
})
test('late board responses cannot replace another selected tool',async()=>{
  let resolve,painted=false
  const context={BID:null,BSCOPE:'research',PAGE:'research',window:{__TM_WORKSPACE:true,__TM_WORKSPACE_REQUEST:5,__TM_WORKSPACE_VISIBLE:true},tryJSON:()=>new Promise(r=>resolve=r),toast:()=>{painted=true},renderBoard:()=>{painted=true}}
  vm.createContext(context);vm.runInContext(extract('async function openPost(id, opts){','\nasync function openForm(post){'),context)
  const pending=context.openPost(123)
  context.PAGE='log';context.window.__TM_WORKSPACE_REQUEST=6
  resolve({ok:false})
  await pending;assert.equal(painted,false)
})
function bridgeContext(){
  const calls=[];let handler
  const parent={}
  const context={window:{__TM_WORKSPACE:true,__TM_WORKSPACE_REQUEST:0,__TM_WORKSPACE_VISIBLE:true,parent,addEventListener:(_,fn)=>{handler=fn}},Number,
    location:{origin:'https://tm26.test',protocol:'https:'},history:{replaceState:(_,__,hash)=>calls.push(['hash',hash])},
    document:{getElementById:()=>null},homeTimer:()=>{},PAGE:'dash',ME_READY:true,ME:{signedIn:true},START_POST:0,
    go:(page)=>{calls.push(['go',page]);context.PAGE=page},openPost:(id)=>calls.push(['post',id]),goLogin:()=>calls.push(['login']),loadMe:async()=>{}}
  vm.createContext(context);vm.runInContext(extract('// Only the parent owns history;','\nconst THEME_KEY'),context)
  return {context,calls,send:data=>handler({origin:'https://tm26.test',source:parent,data})}
}
test('parent navigation updates the child hash and preserves a deep post',async()=>{
  const {calls,send}=bridgeContext()
  await send({type:'tm-workspace-navigate',page:'research/123',requestId:3})
  assert.deepEqual(calls,[['hash','#research/123'],['go','research'],['post',123]])
})
test('watchlist waits for auth; a later tool switch cancels its login redirect',async()=>{
  const {context,calls,send}=bridgeContext()
  let finish
  context.ME_READY=false;context.ME.signedIn=false;context.loadMe=()=>new Promise(resolve=>{finish=resolve})
  const watch=send({type:'tm-workspace-navigate',page:'watch',requestId:3})
  assert.equal(calls.some(x=>x[0]==='login'),false)
  await send({type:'tm-workspace-visibility',visible:false,requestId:4})
  finish();await watch
  assert.equal(calls.some(x=>x[0]==='login'),false)
})


test('retired account links resolve to local administration in the native workspace',()=>{
  for(const page of ['account','admin']){
    assert.deepEqual(selectionForPage(page),{area:'terminal',page:'admin'});
    assert.deepEqual(selectionFromHash('#'+page),{area:'terminal',page:'admin'});
    assert.deepEqual(selectionFromHash('#trading/'+page),{area:'terminal',page:'admin'});
    assert(nativePages.has(selectionForPage(page).page));
  }
});

test('retired general board links open the research workspace without deleting stored posts',()=>{
  assert.deepEqual(selectionForPage('board'),{area:'terminal',page:'research'});
  assert.deepEqual(selectionFromHash('#board/42'),{area:'terminal',page:'research/42'});
  assert.equal(nativePages.has('board'),false);
});

import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import {allowedWriteOrigin} from '../lib/request-security.mjs'
const req=(method='POST',headers={},body={})=>new Request('http://127.0.0.1:8766/api/test',{method,headers,...(!['GET','HEAD'].includes(method)?{body:JSON.stringify(body)}:{})})
function load(path,deps,names){
 const code=fs.readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/^import [\s\S]*? from ['"][^'"\n]+['"];?\s*$/gm,'').replace(/export /g,'')
 return new Function(...Object.keys(deps),code+'\nreturn {'+names.join(',')+'}')( ...Object.values(deps))
}
const noop=async()=>{}
const NextResponse=class extends Response {static json(o,init){return Response.json(o,init)}}
const admin={id:1,role:'admin',verified:true}, member={id:2,role:'user',verified:true}
const base={NextResponse,ensureFiles:noop,ensureBoard:noop,ensureTables:noop,ADMIN_ONLY:new Set(['review']),AUTO_ONLY:new Set(['strategy','review']),isAdmin:u=>u?.role==='admin',catOf:v=>v||'free',linkFiles:noop}
test('browser write origin checks preserve key automation and same-origin forms',()=>{
 assert.equal(allowedWriteOrigin(req('POST',{origin:'https://evil.example'})),false)
 assert.equal(allowedWriteOrigin(req('PATCH',{origin:'null'})),false)
 assert.equal(allowedWriteOrigin(req('POST',{'sec-fetch-site':'same-site'})),false)
 assert.equal(allowedWriteOrigin(req('POST',{cookie:'tm_session=fake'})),false)
 assert.equal(allowedWriteOrigin(req('POST',{origin:'http://127.0.0.1:8766'})),true)
 assert.equal(allowedWriteOrigin(req('POST',{'x-screener-key':'fixture'})),true)
 assert.equal(allowedWriteOrigin(req('GET',{origin:'https://evil.example'})),true)
})
function fileRoute({user=null,auto=null,post='review',orphan=false,owner=2,fail=false,mime='image/png'}={}){
 const sql=async(strings)=>{
  const q=strings.join('?')
  if(q.includes('FROM screener_file'))return [{filename:'fixture.png',mime,data:Buffer.from('fixture').toString('base64'),post_id:orphan?null:7,user_id:owner}]
  if(q.includes('FROM screener_post')){if(fail)throw Error('database unavailable');return post===null?[]:[{cat:post}]}
  return []
 }
 return load('app/api/files/get/route.js',{...base,getSql:async()=>sql,currentUser:async()=>user,keyAdmin:async()=>auto},['GET']).GET(new Request('http://127.0.0.1:8766/api/files/get?id=7'))
}
test('private attachments block guests/members and fail closed on lookup errors',async()=>{
 for(const args of [{},{user:member},{post:null}])assert.equal((await fileRoute(args)).status,404)
 assert.equal((await fileRoute({user:admin})).status,200)
 assert.equal((await fileRoute({auto:admin})).status,200)
 assert.equal((await fileRoute({fail:true,user:admin})).status,503)
})
test('unpublished files require ownership; public images and member PDFs still work',async()=>{
 assert.equal((await fileRoute({orphan:true})).status,404)
 assert.equal((await fileRoute({orphan:true,user:member,owner:3})).status,404)
 assert.equal((await fileRoute({orphan:true,user:member})).status,200)
 assert.equal((await fileRoute({post:'report'})).status,200)
 assert.equal((await fileRoute({post:'report',mime:'application/pdf'})).status,401)
 const response=await fileRoute({post:'report',mime:'application/pdf',user:member})
 assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/)
})
test('attachment metadata applies the same private category restriction',async()=>{
 for(const user of [null,member,admin]){
  let filesRead=false
  const sql=async(strings)=>{if(strings.join('').includes('FROM screener_post'))return [{cat:'review'}];filesRead=true;return []}
  const {GET}=load('app/api/files/route.js',{...base,crypto,getSql:async()=>sql,currentUser:async()=>user,keyAdmin:async()=>null},['GET'])
  const response=await GET(new Request('http://127.0.0.1:8766/api/files?post=7'))
  assert.equal(response.status,user===admin?200:404);assert.equal(filesRead,user===admin)
 }
})
test('post update rejects category escalation and oversized content; automation keeps category',async()=>{
 for(const [auto,cat,body,status] of [[null,'free',{title:'a',cat:'review'},403],[null,'strategy',{title:'a',cat:'free'},403],[null,'free',{title:'x'.repeat(121)},400],[null,'free',{title:'a',body:'x'.repeat(20001)},400],[null,'free',{title:'a'},200],[admin,'review',{title:'a'},200]]){
  let wrote=false
  const sql=async(strings)=>{if(strings.join('').includes('SELECT'))return [{user_id:(auto||member).id,cat}];wrote=true;return []}
  const {PATCH}=load('app/api/board/[id]/route.js',{...base,getSql:async()=>sql,currentUser:async()=>member,keyAdmin:async()=>auto},['PATCH'])
  assert.equal((await PATCH(req('PATCH',{},body),{params:Promise.resolve({id:7})})).status,status)
  assert.equal(wrote,status===200)
 }
})
test('rate limit database failure denies attempts',async()=>{
 const {tooMany}=load('lib/limit.js',{},['tooMany'])
 assert.equal(await tooMany(async()=>{throw Error('unavailable')},'fixture',10,10),true)
})
test('password change invalidates previously issued sessions without leaking hashes',async()=>{
 const oldSecret=process.env.AUTH_SECRET;process.env.AUTH_SECRET='test-only-secret-not-a-production-key'
 try{
  let token,hash='scrypt$test$hash1'
  const jar={get:()=>({value:token}),set:(_name,value)=>{token=value}}
  const sql=async()=>[{...member,pass_hash:hash}]
  const {setSession,currentUser}=load('lib/auth.js',{crypto,cookies:async()=>jar,getSql:async()=>sql,once:()=>noop},['setSession','currentUser'])
  await setSession(2)
  assert.equal((await currentUser()).id,2);assert.equal('pass_hash' in await currentUser(),false)
  const first=token;hash='scrypt$test$hash2';assert.equal(await currentUser(),null)
  await setSession(2);assert.equal((await currentUser()).id,2)
  token=first.slice(0,-1)+'x';assert.equal(await currentUser(),null)
 }finally{if(oldSecret===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=oldSecret}
})

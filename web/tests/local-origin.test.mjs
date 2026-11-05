import test from 'node:test'
import assert from 'node:assert/strict'
import {allowedWriteOrigin,requestOrigin} from '../lib/request-security.mjs'
test('local Host remains same-origin when Next internally uses localhost',()=>{
 const old=process.env.TM26_LOCAL_ONLY;process.env.TM26_LOCAL_ONLY='1'
 try{
  const req=(origin,extra={})=>new Request('http://localhost:8766/api/chat',{method:'POST',headers:{host:'127.0.0.1:8766',origin,...extra}})
  assert.equal(requestOrigin(req('http://127.0.0.1:8766')),'http://127.0.0.1:8766')
  assert.equal(allowedWriteOrigin(req('http://127.0.0.1:8766')),true)
  for(const origin of ['null','https://evil.example','http://127.0.0.1:8000','http://localhost:8766'])assert.equal(allowedWriteOrigin(req(origin)),false)
  assert.equal(allowedWriteOrigin(req('https://evil.example',{'x-forwarded-host':'evil.example'})),false)
 }finally{if(old===undefined)delete process.env.TM26_LOCAL_ONLY;else process.env.TM26_LOCAL_ONLY=old}
})

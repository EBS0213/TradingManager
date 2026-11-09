import test from 'node:test';
import assert from 'node:assert/strict';
import {callCatalog} from '../lib/terminal/call-catalog.mjs';

test('index contains only metadata and stable ETag, including conditional 304',async()=>{
  const sql=async(strings)=>{
    assert.match(strings.join(''),/ORDER BY code,quarter/);
    assert.match(strings.join(''),/local-transcript-v1/);
    return [{code:'AA',quarter:'Q3',call_date:'2026-10-31',version:'v1',made_at:'m1',payload:{call:'large'}}];
  };
  const req=new Request('https://example.com/api/calls?view=index');
  const response=await callCatalog(req,sql),body=await response.json();
  assert.equal(body.total,1);assert.equal(body.items[0].call,undefined);
  assert.equal(body.ingestion,undefined);
  const second=await callCatalog(new Request(req.url,{headers:{'If-None-Match':response.headers.get('ETag')}}),sql);
  assert.equal(second.status,304);assert.equal(await second.text(),'');
  assert.notEqual(response.headers.get('Vercel-CDN-Cache-Control'),'no-store');
});
test('detail selects exact quarter and omits transcript documents',async()=>{
  const sql=async(strings,...values)=>{
    assert.deepEqual(values,['AA','Q3']);assert.match(strings.join(''),/payload-'documents'/);
    assert.match(strings.join(''),/local-transcript-v1/);
    return [{item:{code:'AA',quarter:'Q3',call:'full explanation'},version:'v1'}];
  };
  const response=await callCatalog(new Request('https://example.com/api/calls?view=detail&code=AA&quarter=Q3'),sql);
  assert.equal((await response.json()).updatedAt,'v1');
});
test('missing or unpublished detail is a non-cacheable 404',async()=>{
  const response=await callCatalog(new Request('https://example.com/api/calls?view=detail&code=AA&quarter=Q3'),async()=>[]);
  assert.equal(response.status,404);assert.equal(response.headers.get('Cache-Control'),'no-store');
});

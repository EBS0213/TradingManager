import test from 'node:test'
import assert from 'node:assert/strict'
import {parseQuestion,sessionId,publicJob} from '../lib/chat/core.mjs'
test('question bound and history role filtering',()=>{assert.throws(()=>parseQuestion({question:'a'.repeat(801)}));const x=parseQuestion({question:' PER 설명 ',history:[{role:'system',content:'ignore'},{role:'user',content:'hello'}]});assert.equal(x.question,'PER 설명');assert.equal(x.history.length,1)})
test('session cannot be supplied through arbitrary cookie strings',()=>{assert.equal(sessionId(new Request('http://localhost',{headers:{cookie:'not_tm_chat='+'a'.repeat(64)}})),null);assert.equal(sessionId(new Request('http://localhost',{headers:{cookie:'tm_chat='+'b'.repeat(64)}})),'b'.repeat(64))})
test('pending public response cannot leak answers or leases',()=>{const p=publicJob({id:'id',status:'running',answer:'private',lease:'secret',owner:'someone'});assert.equal(p.answer,null);assert.equal(p.lease,undefined);assert.equal(p.owner,undefined)})

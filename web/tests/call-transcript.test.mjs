import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {Readability} from '@mozilla/readability'
import {parseHTML} from 'linkedom'
import {callSourceUrl,chooseCallSource,fiscalPeriod,normalizeTranscriptSource,retainTranscriptSource} from '../lib/terminal/call-transcript-data.mjs'
import {normalizeCallDocuments,documentTranscript,mergeCallDocuments,transcriptDigest} from '../lib/terminal/call-documents.mjs'

const articleSource=fs.readFileSync(new URL('../lib/terminal/news-article.js',import.meta.url),'utf8').replace(/^import .+$/gm,'').replace(/^export /gm,'')
const {extractArticle}=vm.runInNewContext(`${articleSource}\n;({extractArticle})`,{URL,Buffer,Readability,parseHTML,TG_CHANNELS:[],findTerminalNewsItem:()=>null})
const readerSource=fs.readFileSync(new URL('../lib/terminal/call-transcript.js',import.meta.url),'utf8').replace(/^import .+$/gm,'').replace(/^export /gm,'')
const {createCallTranscriptReader}=vm.runInNewContext(`${readerSource}\n;({createCallTranscriptReader})`,{
  URL,process:{env:{}},setTimeout,clearTimeout,callSourceUrl,chooseCallSource,fiscalPeriod,extractArticle,normalizeCallDocuments,documentTranscript,
  getSql:()=>{throw new Error('Unexpected DB')},readPublisherPage:()=>{throw new Error('Unexpected network')},
})
const fool='https://www.fool.com/earnings/call-transcripts/2026/10/01/example-test-q4-2026-earnings-call-transcript/'
const sec='https://www.sec.gov/Archives/edgar/data/12345/000001234526000001/earnings.htm'
const item={code:'TEST',name:'Example',quarter:'2026 회계연도 4분기',sources:[{label:'SEC 8-K EX-99.1',url:sec}],
  transcriptSource:{url:fool,collector:'foolcalls',year:2026,quarter:4,sha256:'a'.repeat(64),upstreamCommit:'b'.repeat(40)}}
const title='Example (TEST) Q4 2026 Earnings Call Transcript'
const para='This synthetic paragraph tests public document extraction and contains no real company statements. It has sufficient punctuation and content to be recognized as readable article text.'
const html=`<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${para}</p><p>${para} A final sentence.</p></article></body></html>`

test('only public Fool transcript and SEC archive addresses are eligible sources',()=>{
  for(const url of ['http://www.fool.com/x','https://www.fool.com.evil.test/earnings/call-transcripts/2026/01/01/x/','https://www.sec.gov/member','https://user:pass@www.sec.gov/Archives/edgar/data/1/2/x.htm','https://127.0.0.1/x','file:///tmp/x'])assert.equal(callSourceUrl(url),null)
  assert.equal(callSourceUrl(fool).href,fool)
  assert.equal(callSourceUrl(sec).href,sec)
  assert.deepEqual(fiscalPeriod('2026년 4분기'),{year:2026,quarter:4})
  assert.equal(normalizeTranscriptSource({...item.transcriptSource,quarter:5}),null)
})
test('source selection requires catalog membership and matching stored fiscal provenance',()=>{
  assert.equal(chooseCallSource(item).url,fool)
  assert.equal(chooseCallSource(item,sec).kind,'filing')
  assert.equal(chooseCallSource(item,`${fool}?arbitrary=1`),null)
  assert.equal(chooseCallSource({...item,transcriptSource:{...item.transcriptSource,year:2027}}).kind,'filing')
})
test('reader rejects unlinked URLs before fetching and verifies Fool title identity',async()=>{
  let reads=0
  const read=createCallTranscriptReader({findItem:async()=>item,readPage:async url=>{reads++;return {url,html}}})
  assert.equal((await read({code:'TEST',url:`${fool}?arbitrary=1`})).status,'unavailable')
  assert.equal(reads,0)
  const available=await read({code:'TEST',quarter:item.quarter})
  assert.equal(available.status,'available')
  assert.equal(available.kind,'transcript')
  assert.ok(available.transcript.includes(para))
  assert.equal(available.quarter,item.quarter)
  const wrong=createCallTranscriptReader({findItem:async()=>item,readPage:async url=>({url,html:html.replaceAll('Q4 2026','Q3 2026')})})
  assert.equal((await wrong({code:'TEST'})).status,'unavailable')
  const wrongTicker=createCallTranscriptReader({findItem:async()=>item,readPage:async url=>({url,html:html.replaceAll('(TEST)','(OTHER)')})})
  assert.equal((await wrongTicker({code:'TEST'})).status,'unavailable')
})
test('SEC public documents remain filing material and never populate transcript',async()=>{
  const read=createCallTranscriptReader({findItem:async()=>({...item,transcriptSource:null}),readPage:async url=>({url,html})})
  const result=await read({code:'TEST'})
  assert.equal(result.status,'available')
  assert.equal(result.kind,'filing')
  assert.equal(result.transcript,'')
  assert.ok(result.note.includes('발언 전문은 아닙니다'))
  assert.ok(result.paragraphs.length>0)
})
test('full-transcript marker excludes article summaries and post-call promotional sections',async()=>{
  const marked=html.replace('<p>',`<p>ARTICLE_SUMMARY. ${para}</p><h2>Full Conference Call Transcript</h2><p>`)
    .replace('</article>','<h2>Call Participants:</h2><p>PROMOTION_AFTER_CALL</p></article>')
  const read=createCallTranscriptReader({findItem:async()=>item,readPage:async url=>({url,html:marked})})
  const result=await read({code:'TEST'})
  assert.equal(result.status,'available')
  assert.ok(result.transcript.includes(para))
  assert.ok(!result.transcript.includes('ARTICLE_SUMMARY'))
  assert.ok(!result.transcript.includes('PROMOTION_AFTER_CALL'))
})
test('paywalls remain restricted and concurrent requests share the bounded ten-minute cache',async()=>{
  let reads=0,now=0
  const read=createCallTranscriptReader({now:()=>now,findItem:async()=>item,readPage:async url=>{reads++;return {url,restricted:true}}})
  const results=await Promise.all([read({code:'TEST'}),read({code:'TEST'})])
  assert.ok(results.every(row=>row.status==='restricted'&&row.transcript===''&&row.paragraphs.length===0))
  assert.equal(reads,1)
  await read({code:'TEST'});assert.equal(reads,1)
  now=600001;await read({code:'TEST'});assert.equal(reads,2)
})

test('older summary uploads preserve verified transcript provenance only for the same fiscal period',()=>{
  assert.deepEqual(retainTranscriptSource({quarter:item.quarter},item),normalizeTranscriptSource(item.transcriptSource))
  assert.equal(retainTranscriptSource({quarter:'2025 Q4'},item),null)
})

const original=Array.from({length:8},(_,i)=>`Speaker ${i}. ${para}`).join('\n\n')
const documents={code:'TEST',year:2026,quarter:4,sourceUrl:fool,original,sha256:transcriptDigest(original),
  translation:{sourceSha256:transcriptDigest(original),paragraphs:Array.from({length:8},(_,i)=>`발언자 ${i}. 가상 검증 자료의 한국어 전체 문단입니다.`)}}
test('stored original and Korean full text are served without refetching the publisher',async()=>{
  const read=createCallTranscriptReader({findItem:async()=>({...item,documents}),readPage:async()=>{throw new Error('must not fetch')}})
  const en=await read({code:'TEST'}),ko=await read({code:'TEST',language:'ko'})
  assert.equal(en.status,'available');assert.equal(en.transcript,original)
  assert.equal(ko.status,'available');assert.equal(ko.paragraphs.length,8)
  assert.ok(ko.transcript.includes('발언자 7'))
})
test('missing or incomplete translation never masquerades as a complete Korean transcript',async()=>{
  assert.throws(()=>normalizeCallDocuments({...documents,translation:{...documents.translation,paragraphs:['누락']}},item),/문단 수/)
  assert.throws(()=>normalizeCallDocuments({...documents,sha256:'a'.repeat(64)},item),/검증값/)
  assert.throws(()=>normalizeCallDocuments({...documents,year:2027},item),/회계기간/)
  const read=createCallTranscriptReader({findItem:async()=>({...item,documents:{...documents,translation:null}})})
  const ko=await read({code:'TEST',language:'ko'})
  assert.equal(ko.status,'unavailable');assert.equal(ko.transcript,'')
})
test('summary-only updates preserve documents, while a changed original invalidates the old translation',()=>{
  const normalized=normalizeCallDocuments(documents,item)
  assert.deepEqual(mergeCallDocuments(null,documents,item),normalized)
  assert.deepEqual(mergeCallDocuments({...documents,translation:null},documents,item).translation,normalized.translation)
  const changed=original+' Changed.'
  assert.equal(mergeCallDocuments({...documents,original:changed,sha256:transcriptDigest(changed),translation:null},documents,item).translation,null)
})
test('a storage failure remains an error rather than falsely reporting a missing transcript',async()=>{
  const read=createCallTranscriptReader({findItem:async()=>{throw new Error('database delayed')}})
  await assert.rejects(read({code:'TEST'}),/database delayed/)
})

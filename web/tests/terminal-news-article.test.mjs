import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {isIP} from 'node:net'
import {Readability} from '@mozilla/readability'
import {parseHTML} from 'linkedom'
import {publisherUrl,googleNewsUrl,googleReaderUrl,resolveGoogleNewsUrl} from '../lib/terminal/news-publishers.mjs'
import {TG_CHANNELS} from '../lib/tgfeed.js'

const source=fs.readFileSync(new URL('../lib/terminal/news-article.js',import.meta.url),'utf8')
  .replace(/^import .+$/gm,'').replace(/^export /gm,'')
const api=vm.runInNewContext(`${source}\n;({articleUrl,isPublicAddress,extractArticle,readPublisherPage,createArticleReader})`,{
  URL,Buffer,TextDecoder,AbortSignal,Readability,parseHTML,TG_CHANNELS,isIP,publisherUrl,googleNewsUrl,googleReaderUrl,resolveGoogleNewsUrl,
  lookupHost:()=>{throw new Error('Unexpected DNS')},httpsRequest:()=>{throw new Error('Unexpected network')},findTerminalNewsItem:()=>null,
})
const url='https://www.cnbc.com/2026/10/22/public-news.html'
const item={url,title:'Public news',source:'CNBC',summary:'Publisher RSS summary'}
const paragraph='Public economic observations describe changes in investment, employment and consumer demand. This is readable public reporting with enough punctuation and detail for the reader parser.'
const html=`<!doctype html><html><head><title>Public news</title></head><body><article><h1>Public news</h1><p>${paragraph}</p><p>${paragraph} A second observed fact.</p></article></body></html>`

test('only HTTPS publisher URLs or known public Telegram posts pass URL validation',()=>{
  for(const value of ['http://www.cnbc.com/a','https://user:secret@www.cnbc.com/a','https://www.cnbc.com:8443/a','https://www.cnbc.com.evil.test/a','https://127.0.0.1/a','https://[::1]/a','file:///etc/passwd','https://t.me/unknown/1','https://t.me/livesquaw/1?next=evil','https://www.cnbc.com/a\n'])assert.equal(api.articleUrl(value),null,value)
  assert.equal(api.articleUrl(url).href,url)
  for(const host of ['www.etnews.com','www.etoday.co.kr'])assert.equal(api.articleUrl(`https://${host}/article`).hostname,host)
  assert.equal(api.articleUrl('https://www.etnews.com.evil.test/a'),null)
  assert.equal(api.articleUrl('https://t.me/livesquaw/123').hostname,'t.me')
})
test('private, reserved, local, mapped and documentation IP ranges are blocked',()=>{
  for(const address of ['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::1'])assert.equal(api.isPublicAddress(address),false,address)
  assert.equal(api.isPublicAddress('8.8.8.8'),true)
  assert.equal(api.isPublicAddress('2606:4700:4700::1111'),true)
})
test('reader returns text only, does not execute scripts and excludes hidden content',()=>{
  delete globalThis.__tm26_article_test
  const parsed=api.extractArticle(html.replace('</article>','<p hidden>Hidden text</p><p style="display:none">Secret text</p><script>globalThis.__tm26_article_test=true</script><img src=x onerror="globalThis.__tm26_article_test=true"></article>'),url)
  assert.equal(parsed.status,'available')
  assert.ok(parsed.paragraphs.length>=2)
  assert.ok(parsed.paragraphs.every(value=>typeof value==='string'&&!value.includes('<script')&&!value.includes('Hidden text')&&!value.includes('Secret text')))
  assert.equal(globalThis.__tm26_article_test,undefined)
  assert.equal(Object.hasOwn(parsed,'content'),false)
})
test('declared paywalls and browser challenges are restricted before extraction',()=>{
  for(const marker of ['<script type="application/ld+json">{"@graph":[{"isAccessibleForFree":false}]}</script>','<meta itemprop="isAccessibleForFree" content="false">','<form id="challenge-form"></form>'])assert.equal(api.extractArticle(html.replace('</head>',`${marker}</head>`),url).status,'restricted')
})
test('marked publisher article bodies exclude unrelated market sidebars',()=>{
  const page=html.replace('<article>','<article itemprop="articleBody">').replace('</body>',`<aside>${Array.from({length:30},()=>`<p>Unrelated market sidebar. ${paragraph}</p>`).join('')}</aside></body>`)
  const parsed=api.extractArticle(page,url)
  assert.equal(parsed.status,'available')
  assert.ok(parsed.paragraphs.length>=2)
  assert.ok(parsed.paragraphs.every(row=>!row.includes('Unrelated market sidebar')))
})
test('temporary failures can be retried without waiting for the success cache',async()=>{
  let failed=true
  const get=api.createArticleReader({findItem:async()=>item,readPage:async()=>{if(failed)throw new Error('temporary');return {html,url}}})
  assert.equal((await get(url)).status,'unavailable')
  failed=false
  assert.equal((await get(url)).status,'available')
})
test('catalog membership gates all network, Telegram uses only the official widget and restrictions keep summaries',async()=>{
  let reads=0,lookups=0
  const get=api.createArticleReader({findItem:async requested=>{lookups++;return requested===url?item:null},readPage:async()=>{reads++;return {restricted:true,url}}})
  assert.equal((await get('http://127.0.0.1')).status,'unavailable')
  assert.equal(lookups,0)
  assert.equal((await get('https://www.cnbc.com/not-in-catalog')).status,'unavailable')
  assert.equal(reads,0)
  const result=await get(url)
  assert.equal(result.status,'restricted')
  assert.equal(result.paragraphs[0],item.summary)
  await get(url)
  assert.equal(reads,1)
  const telegram=api.createArticleReader({findItem:async requested=>({url:requested,title:'Channel message',source:'Live Squawk',category:'telegram'}),readPage:()=>{throw new Error('Telegram should not be scraped')}})
  const post=await telegram('https://t.me/livesquaw/123')
  assert.equal(post.mode,'embed')
  assert.equal(post.embedUrl,'https://t.me/livesquaw/123?embed=1')
})
test('reader cache is bounded to 100 entries and expires after ten minutes',async()=>{
  let reads=0,now=1000
  const get=api.createArticleReader({now:()=>now,findItem:async requested=>({...item,url:requested}),readPage:async requested=>{reads++;return {html,url:requested}}})
  for(let i=0;i<101;i++)await get(`${url}?article=${i}`)
  await get(`${url}?article=100`)
  assert.equal(reads,101)
  await get(`${url}?article=0`)
  assert.equal(reads,102)
  now+=600001;await get(`${url}?article=100`)
  assert.equal(reads,103)
})
function requestStub({status=200,headers={'content-type':'text/html'},body=html,inspect=()=>{}}={}){
  return (requested,options,onResponse)=>{
    inspect(requested,options)
    const req=new EventEmitter()
    req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=status;res.headers=headers;onResponse(res);if(!res.destroyed)res.end(body)})
    return req
  }
}
test('socket uses the validated DNS address and redirects never reach private hosts',async()=>{
  const lookup=async()=>[{address:'8.8.8.8',family:4}]
  let pinned=false
  const page=await api.readPublisherPage(url,{lookup,request:requestStub({inspect:(_url,options)=>options.lookup('www.cnbc.com',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);pinned=true})})})
  assert.ok(pinned)
  assert.equal(page.html,html)
  await assert.rejects(api.readPublisherPage(url,{lookup,request:requestStub({status:302,headers:{location:'https://127.0.0.1/private'}})}))
  let requested=false
  await assert.rejects(api.readPublisherPage(url,{lookup:async()=>[{address:'169.254.169.254',family:4}],request:()=>{requested=true}}))
  assert.equal(requested,false)
})
test('403 and oversized or non-HTML responses cannot become readable articles',async()=>{
  const lookup=async()=>[{address:'8.8.8.8',family:4}]
  assert.equal((await api.readPublisherPage(url,{lookup,request:requestStub({status:403})})).restricted,true)
  await assert.rejects(api.readPublisherPage(url,{lookup,request:requestStub({headers:{'content-type':'text/html','content-length':String(2*1024*1024+1)}})}))
  await assert.rejects(api.readPublisherPage(url,{lookup,request:requestStub({headers:{'content-type':'application/json'}})}))
  await assert.rejects(api.readPublisherPage(url,{lookup,request:requestStub({body:Buffer.alloc(2*1024*1024+1,65)})}))
})

test('industry Google URLs resolve only for catalog members and fetch publisher HTML',async()=>{
  const google='https://news.google.com/rss/articles/CBMiTest?oc=5'
  let resolutions=0,reads=0
  const get=api.createArticleReader({findItem:async requested=>requested===google?{...item,url:google}:null,
    resolveUrl:async requested=>{assert.equal(requested,google);resolutions++;return url},
    readPage:async requested=>{assert.equal(requested,url);reads++;return {html,url}}})
  assert.equal((await get('https://news.google.com/rss/articles/not-in-catalog')).status,'unavailable')
  assert.equal(resolutions,0)
  const result=await get(google)
  assert.equal(result.status,'available');assert.equal(result.url,url);assert.ok(result.paragraphs.length>=2)
  await get(google);assert.equal(resolutions,1);assert.equal(reads,1)
  const unsafe=api.createArticleReader({findItem:async()=>item,resolveUrl:async()=> 'https://127.0.0.1/private',readPage:()=>assert.fail('unsafe destination')})
  assert.equal((await unsafe(google)).status,'unavailable')
})

test('Google resolver parses the article RPC and rejects unapproved destinations',async()=>{
  const google='https://news.google.com/rss/articles/CBMiTest?oc=5'
  const calls=[]
  const resolve=target=>resolveGoogleNewsUrl(google,async(requested,options)=>{
    calls.push({requested,options})
    return {html:options?.method==='POST'?`)]}'\n\n123\n${JSON.stringify([['wrb.fr','Fbv4je',JSON.stringify(['garturlres',target])]])}\n`:
      '<div data-n-a-sg="signature" data-n-a-ts="123456"></div>'}
  })
  assert.equal(await resolve(url),url)
  assert.ok(calls[0].requested.startsWith('https://news.google.com/rss/articles/CBMiTest?'))
  assert.equal(calls[1].options.method,'POST')
  assert.equal(await resolve('https://127.0.0.1/a'),null)
  assert.equal(await resolve('https://www.cnbc.com.evil.test/a'),null)
  for(const raw of ['https://news.google.com.evil.test/rss/articles/x','https://news.google.com/search?q=x','https://news.google.com/rss/articles/x?next=evil'])assert.equal(googleNewsUrl(raw),null)
  for(const host of ['reuters.com','bloomberg.com','wsj.com','apnews.com','biz.chosun.com','news.skhynix.co.kr','newsroom.hyundai.com'])assert.ok(api.articleUrl(`https://${host}/article`),host)
})

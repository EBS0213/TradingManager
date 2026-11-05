import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {TG_CHANNELS} from '../lib/tgfeed.js'

const source=fs.readFileSync(new URL('../lib/terminal/news.js',import.meta.url),'utf8')
  .replace(/^import .+$/gm,'').replace(/^export /gm,'')
const FEEDS=['연합뉴스','매일경제','뉴시스'].map(name=>({name,urls:['https://example.kr/rss']}))
function harness({domestic=[],feeds={},telegram=[]}={}){
  let now=Date.parse('2026-10-21T14:00:00Z'),fail=false,requests=0,telegramCalls=[]
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
  const api=vm.runInNewContext(`${source}\n;({getTerminalNews,findTerminalNewsItem,parseRss,GLOBAL_FEEDS})`,{
    process:{env:{}},Date:Clock,AbortSignal,setTimeout,clearTimeout,URL,FEEDS,TG_CHANNELS,
    getSql:async()=>{throw new Error('No test DB')},fetchNews:async()=>({items:domestic,errors:[]}),
    fetchTgFeeds:async options=>{telegramCalls.push(options);return {items:telegram,errors:[]}},
    fetch:async url=>{requests++;if(fail&&url.includes('cnbc'))throw new Error('failed global feed');const key=Object.keys(feeds).find(key=>url.includes(key));return {ok:true,text:async()=>feeds[key]||''}},
  })
  return {...api,advance:()=>{now+=301000},failGlobal:()=>{fail=true},requests:()=>requests,telegramCalls:()=>telegramCalls}
}
const article=(name,date='Wed, 21 Oct 2026 13:00:00 GMT')=>`<item><title><![CDATA[${name} &amp; markets]]></title><link>https://www.cnbc.com/${name}</link><description><![CDATA[<p>Public &amp; summary</p>]]></description>${date?`<pubDate>${date}</pubDate>`:''}</item>`
test('RSS exposes plain summaries and real dates while dropping unsafe links',()=>{
  const h=harness()
  const rows=h.parseRss(`<rss>${article('headline',null)}<item><title>bad</title><link>javascript:alert(1)</link></item></rss>`,{name:'CNBC',id:'cnbc',market:'GLOBAL',category:'markets',language:'en'})
  assert.equal(rows.length,1)
  assert.equal(rows[0].title,'headline & markets')
  assert.equal(rows[0].summary,'Public & summary')
  assert.equal(rows[0].publishedAt,null)
})
test('per-source caps retain publisher RSS and omit every Telegram channel at 170 items',async()=>{
  const h=harness({domestic:FEEDS.flatMap(feed=>Array.from({length:30},(_,i)=>({title:`${feed.name}${i}`,url:`https://example.kr/${feed.name}/${i}`,source:feed.name,ms:Date.parse('2026-10-21T12:00:00Z')}))),
    feeds:Object.fromEntries(['cnbc','bbci','theguardian','ft.com','dowjones','federalreserve'].map(key=>[key,`<rss>${Array.from({length:30},(_,i)=>article(`${key}${i}`)).join('')}</rss>`])),
    telegram:TG_CHANNELS.flatMap(channel=>Array.from({length:15},(_,i)=>({channel:channel.id,no:i+1,title:`Bloomberg report from ${channel.name} ${i}`,outlets:['블룸버그'],ms:Date.parse('2026-10-21T13:30:00Z')})))})
  const all=await h.getTerminalNews()
  assert.equal(all.items.length,170)
  assert.equal(all.items.filter(item=>item.market==='KR').length,60)
  assert.equal(all.sources.filter(source=>source.category==='telegram').length,0)
  assert.ok(all.items.every(item=>item.category!=='telegram'&&!item.url.startsWith('https://t.me/')))
  assert.ok(all.items.every(item=>!Object.hasOwn(item,'bucket')))
  assert.equal(h.telegramCalls().length,0)
  assert.equal(await h.findTerminalNewsItem('https://t.me/hyperspect/1'),null)
  const filtered=await h.getTerminalNews('federal reserve')
  assert.equal(filtered.items.length,10)
  assert.ok(filtered.items.every(item=>item.source==='Federal Reserve'))
  assert.equal(h.requests(),6,'search changes must not refetch the six global feeds')
})
test('global feed failures retain only that source as stale and never remove independent feeds',async()=>{
  const h=harness({domestic:[{title:'한국',url:'https://example.kr/a',source:'연합뉴스'}],feeds:{cnbc:`<rss>${article('CNBC')}</rss>`,federalreserve:`<rss>${article('Fed')}</rss>`}})
  await h.getTerminalNews();h.advance();h.failGlobal()
  const result=await h.getTerminalNews()
  assert.equal(result.items.find(item=>item.source==='CNBC').status,'stale')
  assert.equal(result.items.find(item=>item.source==='연합뉴스').status,'delayed')
  assert.equal(result.items.find(item=>item.source==='연합뉴스').publishedAt,null)
  assert.equal(result.items.find(item=>item.source==='Federal Reserve').status,'delayed')
  assert.equal(result.sources.find(item=>item.name==='BBC Business').status,'unavailable')
  assert.equal(result.sources.find(item=>item.name==='CNBC').status,'stale')
})
test('article lookup requires exact membership in the current cached catalog',async()=>{
  const h=harness({feeds:{cnbc:`<rss>${article('current')}</rss>`}})
  assert.equal((await h.findTerminalNewsItem('https://www.cnbc.com/current')).source,'CNBC')
  assert.equal(await h.findTerminalNewsItem('https://www.cnbc.com/not-in-feed'),null)
  assert.equal(h.requests(),6)
})

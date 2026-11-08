import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {SECTOR_RULES,newsSectors,annotateNews} from '../lib/terminal/news-sectors.mjs'
import {TG_CHANNELS} from '../lib/tgfeed.js'

const source=fs.readFileSync(new URL('../lib/terminal/news.js',import.meta.url),'utf8')
  .replace(/^import .+$/gm,'').replace(/^export /gm,'')
const FEEDS=['연합뉴스','매일경제','뉴시스'].map(name=>({name,urls:['https://example.kr/rss']}))
function harness({domestic=[],feeds={},telegram=[],snapshot=null}={}){
  let now=Date.parse('2026-10-21T14:00:00Z'),fail=false,requests=0,telegramCalls=[]
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
  const api=vm.runInNewContext(`${source}\n;({getTerminalNews,findTerminalNewsItem,parseRss,GLOBAL_FEEDS,INDUSTRY_FEEDS,newsSectors})`,{
    process:{env:snapshot?{DATABASE_URL:'local-test'}:{}},Date:Clock,AbortSignal,setTimeout,clearTimeout,URL,FEEDS,TG_CHANNELS,SECTOR_RULES,newsSectors,annotateNews,
    getSql:async()=>async(_strings,key)=>key==='industry_news'?[{value:snapshot,updated_at:new Date(now)}]:[],fetchNews:async()=>({items:domestic,errors:[]}),
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
  assert.equal(h.requests(),10,'search changes must not refetch the global and industry feeds')
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
  assert.equal(h.requests(),10)
})

test('sector classification covers Korean and English and permits overlapping industries',()=>{
  const h=harness()
  for(const [title,sector] of [['HBM4 반도체 증설','semiconductor'],['TSMC foundry sales rise','semiconductor'],['현대차 전기차 판매 확대','automotive'],['Toyota vehicle exports','automotive'],['정제마진 개선에 정유사 실적 반등','energy'],['OPEC cuts crude oil output','energy']])assert.ok(h.newsSectors({title}).includes(sector),title)
  assert.ok(h.newsSectors({title:'자동차용 전력 반도체 양산'}).includes('automotive'))
  assert.ok(h.newsSectors({title:'자동차용 전력 반도체 양산'}).includes('semiconductor'))
  assert.equal(h.newsSectors({title:'새 아파트 분양',summary:'주말 공연 안내'}).length,0)
  assert.equal(h.newsSectors({title:'Chipotle leadership Kiawah holiday'}).length,0)
  assert.equal(h.newsSectors({title:'공연 흥행 이유가 궁금하다',summary:'현대차 반도체 에너지 기업의 후원'}).length,0)
})
test('industry articles survive general-feed caps and duplicate publisher URLs appear once',async()=>{
  const sectorArticle=(title,id)=>`<item><title>${title}</title><link>https://www.newsis.com/view/${id}</link><pubDate>Wed, 21 Oct 2026 10:00:00 GMT</pubDate></item>`
  const h=harness({domestic:Array.from({length:100},(_,i)=>({title:`국내 경제 ${i}`,url:`https://example.kr/${i}`,source:'연합뉴스',ms:Date.parse('2026-10-21T12:00:00Z')})),feeds:{
    '/RSS/industry.xml':`<rss>${sectorArticle('반도체 HBM 증설','chip')}${sectorArticle('현대차 전기차 판매','auto')}${sectorArticle('원유 정제마진 상승','oil')}</rss>`,
    '/06.xml':`<rss>${sectorArticle('반도체 HBM 증설','chip')}</rss>`,
  }})
  const result=await h.getTerminalNews()
  for(const sector of ['semiconductor','automotive','energy'])assert.ok(result.items.some(item=>item.sectors.includes(sector)))
  assert.equal(result.items.filter(item=>item.url==='https://www.newsis.com/view/chip').length,1)
  assert.equal((await h.getTerminalNews('HBM')).items.length,1)
  assert.ok(result.items.every(item=>!Object.hasOwn(item,'bucket')))
  assert.ok(result.items.length<=result.limits.total)
  assert.equal((await h.findTerminalNewsItem('https://www.newsis.com/view/oil')).source,'뉴시스')
})
test('each sector reserves domestic and foreign article slots and retains stale industry feeds',async()=>{
  const industry=`<rss>${Array.from({length:45},(_,i)=>article(`반도체${i}`)).join('')}</rss>`
  const feeds={'/06.xml':industry}
  const h=harness({feeds})
  const first=await h.getTerminalNews()
  assert.equal(first.items.length,20)
  feeds['/06.xml']='';h.advance()
  const stale=await h.getTerminalNews()
  assert.equal(stale.items.length,20)
  assert.ok(stale.items.every(item=>item.status==='stale'&&item.sectors.includes('semiconductor')))
})

test('stored industry catalog preserves foreign coverage and older leadership slots',async()=>{
  const rows=[]
  for(const [market,source] of [['KR','뉴시스'],['GLOBAL','Reuters']]){
    for(let n=0;n<30;n++)rows.push({title:`반도체 공급 ${market} ${n}`,source,url:`https://example.com/${market}/${n}`,publishedAt:'2026-10-21T13:00:00Z',market,bucket:'industry:stored',category:'industry'})
    rows.push({title:market==='KR'?'최태원 서울대 특강…AI 시대 대응 강조':'Nvidia CEO says chip demand will grow',source,url:`https://example.com/${market}/ceo`,publishedAt:'2026-10-20T13:00:00Z',market,bucket:'industry:stored',category:'industry'})
  }
  const h=harness({snapshot:{updatedAt:'2026-10-21T13:30:00Z',items:rows,sources:[{id:'industry:stored',name:'industry'}]}})
  const result=await h.getTerminalNews()
  for(const market of ['KR','GLOBAL']){
    assert.equal(result.items.filter(row=>row.market===market&&row.kind==='news').length,20)
    assert.ok(result.items.some(row=>row.market===market&&row.kind==='leadership'))
  }
})

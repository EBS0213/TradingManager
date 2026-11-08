// Public RSS collection only. No model calls or outbound notifications.
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createRequire} from 'node:module'
import {annotateNews} from '../../web/lib/terminal/news-sectors.mjs'

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const require=createRequire(path.join(ROOT,'web/package.json'))
const {default:pg}=await import(require.resolve('pg'))
export const DATA=path.join(ROOT,'data/industry-news')
const domestic='(site:yna.co.kr OR site:newsis.com OR site:mk.co.kr OR site:hankyung.com OR site:etnews.com OR site:edaily.co.kr OR site:news1.kr OR site:etoday.co.kr OR site:biz.chosun.com OR site:news.skhynix.co.kr OR site:newsroom.hyundai.com)'
const foreign='(site:reuters.com OR site:bloomberg.com OR site:cnbc.com OR site:ft.com OR site:wsj.com OR site:apnews.com)'
export const PROFILES=[
  {id:'semiconductor',label:'반도체',ko:'(반도체 OR HBM OR 파운드리 OR 메모리)',en:'(semiconductor OR chips OR HBM OR foundry OR Nvidia OR TSMC)',
    leadersKo:'(최태원 OR 곽노정 OR 전영현 OR "젠슨 황" OR "리사 수")',leadersEn:'("Jensen Huang" OR "Lisa Su" OR "C.C. Wei" OR "Sanjay Mehrotra" OR "Chey Tae-won" OR "Samsung CEO" OR "Nvidia CEO" OR "AMD CEO" OR "TSMC CEO")'},
  {id:'automotive',label:'자동차',ko:'(자동차 OR 현대차 OR 기아 OR 테슬라 OR 전기차)',en:'(automotive OR automaker OR Tesla OR Toyota OR Hyundai OR Volkswagen)',
    leadersKo:'(정의선 OR "호세 무뇨스" OR 송호성 OR "일론 머스크")',leadersEn:'("Elon Musk" OR "Mary Barra" OR "Jim Farley" OR "Koji Sato" OR "Akio Toyoda" OR "Jose Munoz" OR "Hyundai CEO")'},
  {id:'energy',label:'에너지/정유',ko:'(에너지 OR 정유 OR 원유 OR 천연가스 OR 정제마진)',en:'("crude oil" OR refinery OR OPEC OR LNG OR Exxon OR Chevron OR Aramco OR "Shell energy")',
    leadersKo:'(최재원 OR 허세홍 OR "아민 나세르" OR "대런 우즈" OR "마이크 워스" OR "에쓰오일 CEO")',leadersEn:'("Darren Woods" OR "Mike Wirth" OR "Wael Sawan" OR "Amin Nasser" OR "Aramco CEO" OR "Shell CEO" OR "Exxon CEO" OR "Chevron CEO" OR "BP CEO" OR "TotalEnergies CEO")'},
]
const spokenKo='(인터뷰 OR 강연 OR 특강 OR 대담 OR 발언 OR 전망 OR 밝혀 OR 강조)'
const spokenEn='(interview OR keynote OR speech OR says OR tells OR outlook OR warns)'
export const SEARCH_FEEDS=PROFILES.flatMap(profile=>['KR','GLOBAL'].flatMap(market=>['news','leadership'].map(kind=>{
  const ko=market==='KR'
  const query=(kind==='leadership'?(ko?profile.leadersKo+' '+spokenKo:profile.leadersEn+' '+spokenEn):(ko?profile.ko:profile.en))+' '+(ko?domestic:foreign)+' when:7d'
  const params=new URLSearchParams({q:query,hl:ko?'ko':'en-US',gl:ko?'KR':'US',ceid:ko?'KR:ko':'US:en'})
  return {id:`industry:search:${profile.id}:${market}:${kind}`,name:`${profile.label} ${ko?'국내':'외신'}${kind==='leadership'?' 기업인 발언':''}`,url:'https://news.google.com/rss/search?'+params,market,language:ko?'ko':'en',category:'industry',sector:profile.id,kind}
})))
const clean=value=>String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()
const tag=(block,name)=>clean(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,'i'))?.[1])
const safeUrl=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}}
export function parseFeed(xml,feed,now=Date.now()){
  return String(xml).split(/<item(?:\s[^>]*)?>/i).slice(1,101).flatMap(block=>{
    const source=tag(block,'source'),rawTitle=tag(block,'title'),suffix=' - '+source
    const title=rawTitle.endsWith(suffix)?rawTitle.slice(0,-suffix.length):rawTitle
    const url=safeUrl(tag(block,'link')),ms=Date.parse(tag(block,'pubDate'))
    if(!source||!title||!url||!Number.isFinite(ms)||ms>now+300000||now-ms>7*86400000)return []
    const row=annotateNews({title:title.slice(0,500),url,source,publishedAt:new Date(ms).toISOString(),summary:'',market:feed.market,language:feed.language,category:'industry',bucket:feed.id,searchUrl:feed.url,sourceUrl:safeUrl(block.match(/<source[^>]+url=["']([^"']+)/i)?.[1]),status:'delayed'})
    if(!row.sectors.includes(feed.sector)||feed.kind==='leadership'&&row.kind!=='leadership')return []
    return [row]
  })
}
async function readFeed(feed){
  const r=await fetch(feed.url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'Mozilla/5.0',Accept:'application/rss+xml,application/xml'}})
  if(!r.ok)throw new Error(`HTTP ${r.status}`)
  const xml=await r.text();if(xml.length>2000000)throw new Error('RSS size limit')
  return parseFeed(xml,feed)
}
const allowedKR=['yna.co.kr','newsis.com','mk.co.kr','hankyung.com','etnews.com','edaily.co.kr','news1.kr','etoday.co.kr','chosun.com','skhynix.co.kr','hyundai.com']
const allowedGlobal=['reuters.com','bloomberg.com','cnbc.com','ft.com','wsj.com','apnews.com']
export function trustedRow(row){
  if(!row.bucket?.startsWith('industry:search:'))return true
  try{const host=new URL(row.sourceUrl).hostname;return (row.market==='KR'?allowedKR:allowedGlobal).some(domain=>host===domain||host.endsWith('.'+domain))}catch{return false}
}
export function mergeRows(previous,incoming,now=Date.now()){
  const rows=new Map(previous.filter(row=>trustedRow(row)&&Date.parse(row.publishedAt)>now-7*86400000).map(row=>annotateNews(row)).filter(row=>row.sectors.length).map(row=>[row.googleUrl||row.url,row]))
  for(const row of incoming.filter(trustedRow)){const key=row.googleUrl||row.url,old=rows.get(key);rows.set(key,{...old,...row,
    ...(old?.googleUrl===row.url?{url:old.url,googleUrl:old.googleUrl}:{}),
    summary:row.summary||old?.summary||'',firstSeenAt:old?.firstSeenAt||new Date(now).toISOString(),lastSeenAt:new Date(now).toISOString()})}
  const seen=new Set()
  return [...rows.values()].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).filter(row=>{const key=row.source+':'+row.title.toLowerCase().replace(/[\p{P}\p{Z}\p{S}]+/gu,'');if(seen.has(key))return false;seen.add(key);return true}).slice(0,900)
}
export async function collect(){
  await fs.mkdir(DATA,{recursive:true,mode:0o700})
  const lock=path.join(DATA,'collect.lock');let handle
  try{handle=await fs.open(lock,'wx',0o600)}catch(error){if(error.code==='EEXIST'){
    const stat=await fs.stat(lock);if(Date.now()-stat.mtimeMs>15*60000){await fs.unlink(lock);return collect()}
    return {status:'already_running'}
  }throw error}
  let client
  try{
    let previous=[];try{previous=JSON.parse(await fs.readFile(path.join(DATA,'snapshot.json'),'utf8')).items||[]}catch{}
    const results=[],errors=[];let cursor=0
    await Promise.all(Array.from({length:4},async()=>{while(cursor<SEARCH_FEEDS.length){const feed=SEARCH_FEEDS[cursor++];try{results.push({feed,items:await readFeed(feed)})}catch(error){errors.push(`${feed.name}: ${error.message}`);results.push({feed,items:[]})}}}))
    // Reuse the terminal's direct publisher feeds as newsbook/chat materials too.
    let terminal=[]
    const localBase=new URL(process.env.TM26_URL||'http://127.0.0.1:8766')
    if(localBase.protocol!=='http:'||localBase.hostname!=='127.0.0.1'||!localBase.port||localBase.username||localBase.password||localBase.pathname!=='/'||localBase.search||localBase.hash)throw new Error('Local terminal URL is required')
    const terminalUrl=new URL('/api/terminal/news',localBase).href
    try{const response=await fetch(terminalUrl,{signal:AbortSignal.timeout(40000)});if(response.ok)terminal=(await response.json()).items.filter(item=>item.sectors?.length).map(item=>({...item,bucket:'industry:terminal'}))}catch(error){errors.push('터미널 직접 RSS: '+error.message)}
    let supplements=[];try{supplements=JSON.parse(await fs.readFile(path.join(DATA,'supplemental.json'),'utf8')).filter(row=>Date.parse(row.publishedAt)>Date.now()-7*86400000).map(annotateNews)}catch(error){if(error.code!=='ENOENT')errors.push('확인 자료 읽기 실패: '+error.message)}
    let items=mergeRows(previous,[...terminal,...results.flatMap(result=>result.items),...supplements])
    const {enrichLeadership}=await import('./enrich.mjs')
    items=await enrichLeadership(items)
    const sources=SEARCH_FEEDS.map(feed=>({...feed,status:results.find(result=>result.feed.id===feed.id)?.items.length?'available':'unavailable',count:results.find(result=>result.feed.id===feed.id)?.items.length||0}))
    sources.push({id:'industry:verified',name:'확인한 기업인 발언',url:'https://www.news1.kr/industry/general-industry/6344815',category:'industry'})
    sources.push({id:'industry:terminal',name:'터미널 산업 RSS',url:terminalUrl,category:'industry'})
    const snapshot={updatedAt:new Date().toISOString(),items,sources,errors}
    const connectionString=process.env.DATABASE_URL
    if(!connectionString||!['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname))throw new Error('Local PostgreSQL is required')
    client=new pg.Client({connectionString});await client.connect()
    await client.query("INSERT INTO screener_settings(key,value,updated_at) VALUES('industry_news',$1::jsonb,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",[JSON.stringify(snapshot)])
    const temp=path.join(DATA,'snapshot.tmp');await fs.writeFile(temp,JSON.stringify(snapshot,null,2),{mode:0o600});await fs.rename(temp,path.join(DATA,'snapshot.json'))
    // Idempotent, separate source archive: never pretend these were channel sends.
    const archive=path.join(DATA,'archive.jsonl');let old=[];try{old=(await fs.readFile(archive,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line))}catch(error){if(error.code!=='ENOENT')throw error}
    const known=new Map(old.filter(trustedRow).map(row=>annotateNews(row)).filter(row=>row.sectors.length).map(row=>[row.googleUrl||row.url,row]));for(const row of items){const key=row.googleUrl||row.url;known.set(key,{...known.get(key),...row})}
    const retained=[...known.values()].filter(row=>Date.parse(row.firstSeenAt)>Date.now()-45*86400000)
    const archiveTemp=path.join(DATA,'archive.tmp');await fs.writeFile(archiveTemp,retained.map(row=>JSON.stringify(row)).join('\n')+'\n',{mode:0o600});await fs.rename(archiveTemp,archive)
    let knowledge=null
    try{const result=await promisify(execFile)(path.join(ROOT,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),[path.join(ROOT,'workers/chat/investment.py'),'--collect-news'],{timeout:60000});knowledge=JSON.parse(result.stdout)}catch(error){errors.push('Gemma 뉴스 지식 동기화: '+error.message.slice(0,200))}
    const counts=Object.fromEntries(PROFILES.map(profile=>[profile.id,{KR:items.filter(row=>row.market==='KR'&&row.sectors.includes(profile.id)).length,GLOBAL:items.filter(row=>row.market==='GLOBAL'&&row.sectors.includes(profile.id)).length,leadership:items.filter(row=>row.kind==='leadership'&&row.sectors.includes(profile.id)).length}]))
    return {updatedAt:snapshot.updatedAt,articles:items.length,counts,knowledge,errors}
  }finally{await client?.end();await handle.close();await fs.unlink(lock)}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await collect(),null,2))}catch(error){console.error(error.code||error.name,error.message);process.exitCode=1}
}

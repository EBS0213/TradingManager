import {SECTOR_RULES,newsSectors,annotateNews} from './news-sectors.mjs'
import {getSql} from '@/lib/db'
import {fetchNews,FEEDS} from '@/lib/rss'
let cached=null,pending=null,loadedAt=0
export const GLOBAL_FEEDS=[
  {id:'cnbc',name:'CNBC',url:'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',market:'GLOBAL',category:'headlines',language:'en'},
  {id:'bbc',name:'BBC Business',url:'https://feeds.bbci.co.uk/news/business/rss.xml',market:'GLOBAL',category:'economy',language:'en'},
  {id:'guardian',name:'The Guardian Business',url:'https://www.theguardian.com/uk/business/rss',market:'GLOBAL',category:'economy',language:'en'},
  {id:'ft',name:'Financial Times',url:'https://www.ft.com/rss/markets',market:'GLOBAL',category:'markets',language:'en'},
  {id:'marketwatch',name:'MarketWatch',url:'https://feeds.content.dowjones.io/public/rss/mw_topstories',market:'GLOBAL',category:'markets',language:'en'},
  {id:'policy',name:'Federal Reserve',url:'https://www.federalreserve.gov/feeds/press_all.xml',market:'US',category:'policy',language:'en'},
]
// Industry feeds supplement the general economy headlines with sector coverage.
export const INDUSTRY_FEEDS=[
  {id:'industry:newsis',name:'뉴시스',url:'https://www.newsis.com/RSS/industry.xml',market:'KR',category:'industry',language:'ko'},
  {id:'industry:etnews-electronics',name:'전자신문',url:'https://rss.etnews.com/06.xml',market:'KR',category:'industry',language:'ko'},
  {id:'industry:etnews-mobility',name:'전자신문',url:'https://rss.etnews.com/17.xml',market:'KR',category:'industry',language:'ko'},
  {id:'industry:etoday',name:'이투데이',url:'https://rss.etoday.co.kr/eto/industry_news.xml',market:'KR',category:'industry',language:'ko'},
]
const clean=text=>String(text||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,'')
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&nbsp;/g,' ')
  .replace(/&#(x[0-9a-f]+|\d+);/gi,(raw,code)=>{const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);return n>0&&n<=0x10ffff?String.fromCodePoint(n):raw})
  .replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
const tag=(xml,name)=>clean(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,'i'))?.[1])
const actualDate=value=>{
  if(typeof value!=='string' || !value.trim())return null
  const ms=Date.parse(value)
  return Number.isFinite(ms)?new Date(ms).toISOString():null
}
const publicLink=value=>{
  try {const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null}
  catch{return null}
}
const telegramLink=value=>{
  try{return ['t.me','www.t.me','telegram.me','www.telegram.me'].includes(new URL(value).hostname)}
  catch{return false}
}
function parseRss(xml,feed){
  return String(xml).split(/<item(?:\s[^>]*)?>/i).slice(1,101).map(block=>({
    title:tag(block,'title').slice(0,500),url:publicLink(tag(block,'link')),source:feed.name,
    publishedAt:actualDate(tag(block,'pubDate')||tag(block,'dc:date')),summary:tag(block,'description').slice(0,800),
    market:feed.market,category:feed.category,language:feed.language,status:'delayed',bucket:feed.id,
  })).filter(item=>item.title&&item.url)
}
async function publicFeed(feed){
  const response=await fetch(feed.url,{cache:'no-store',signal:AbortSignal.timeout(7000),
    headers:{'User-Agent':'Mozilla/5.0',Accept:'application/rss+xml, application/xml, text/xml, */*'}})
  if(!response.ok)throw new Error(`HTTP ${response.status}`)
  const xml=await response.text()
  if(xml.length>2_000_000)throw new Error('피드 크기 제한')
  const items=parseRss(xml,feed)
  if(!items.length)throw new Error('기사가 없습니다')
  return {items,errors:[],sources:[feed]}
}
async function storedNews(key='news'){
  if(!process.env.DATABASE_URL)return null
  let timer
  try{return await Promise.race([(async()=>{
    const sql=await getSql()
    return (await sql`SELECT value, updated_at FROM screener_settings WHERE key=${key}`)[0]||null
  })(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2000)})])}
  catch{return null}finally{clearTimeout(timer)}
}
async function koreanNews(){
  const stored=await storedNews()
  let rows=[],errors=[],stale=false
  if(stored?.value?.news?.length && Date.now()-new Date(stored.updated_at).getTime()<900_000)rows=stored.value.news
  else {
    const fresh=await fetchNews({max:120})
    rows=fresh.items;errors=fresh.errors||[]
    if(!rows.length && stored?.value?.news?.length){rows=stored.value.news;stale=true}
  }
  const sources=new Map(FEEDS.map(feed=>[feed.name,{id:`domestic:${feed.name}`,name:feed.name,url:feed.urls[0]}]))
  const items=rows.slice(0,200).filter(item=>item.title&&publicLink(item.url)).map(item=>{
    const source=clean(item.source||'한국 경제 RSS')
    if(!sources.has(source))sources.set(source,{id:`domestic:${source}`,name:source,url:null})
    return {title:clean(item.title).slice(0,500),url:publicLink(item.url),source,summary:clean(item.summary).slice(0,800),
      publishedAt:typeof item.ms==='number'&&Number.isFinite(item.ms)&&Math.abs(item.ms)<=8.64e15?new Date(item.ms).toISOString():actualDate(item.publishedAt),
      market:'KR',category:'economy',language:'ko',status:stale?'stale':'delayed',bucket:`domestic:${source}`}
  })
  return {items,errors,sources:[...sources.values()]}
}
async function build(){
  // RSS jobs run at most three at a time; no per-article requests occur here.
  const feeds=[...GLOBAL_FEEDS,...INDUSTRY_FEEDS]
  const globalResults=new Array(feeds.length)
  let cursor=0
  const jobs=Array.from({length:3},async()=>{
    while(cursor<feeds.length){
      const index=cursor++,feed=feeds[index]
      try{globalResults[index]=await publicFeed(feed)}
      catch{globalResults[index]={items:[],sources:[feed],errors:[`${feed.name}: 공개 RSS를 받지 못했습니다.`]}}
    }
  })
  const [domestic,industry]=await Promise.all([
    koreanNews().catch(()=>({items:[],sources:FEEDS.map(feed=>({id:`domestic:${feed.name}`,name:feed.name,url:feed.urls[0]})),errors:['한국 경제 RSS를 받지 못했습니다.']})),
    storedNews('industry_news'),
    Promise.all(jobs),
  ])
  const items=[],errors=[],sources=[]
  const snapshot=industry?.value
  if(Array.isArray(snapshot?.items)){
    const stale=Date.now()-Date.parse(snapshot.updatedAt)>3_600_000
    globalResults.push({items:snapshot.items.map(item=>({...item,status:stale?'stale':item.status||'delayed',bucket:item.bucket||'industry:search'})),sources:(snapshot.sources||[]).map(source=>({...source,id:source.id||'industry:search'})),errors:snapshot.errors||[]})
  }
  for(const result of [domestic,...globalResults]){
    errors.push(...result.errors)
    for(const feed of result.sources){
      let rows=result.items.filter(item=>item.bucket===feed.id)
      if(!rows.length)rows=(cached?.items||[]).filter(item=>item.bucket===feed.id).map(item=>({...item,status:'stale'}))
      sources.push({id:feed.id,name:feed.name,url:feed.url||null,category:feed.category,channel:feed.channel,
        status:!rows.length?'unavailable':rows.every(item=>item.status==='stale')?'stale':'available',count:rows.length})
      items.push(...rows)
    }
  }
  const seen=new Set()
  const unique=items.filter(item=>{if(item.category==='telegram'||telegramLink(item.url))return false;const key=item.url;if(seen.has(key))return false;seen.add(key);return true}).map(annotateNews)
  unique.sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0))
  return {items:unique,source:'TM26 공개 RSS',status:!unique.length?'unavailable':unique.every(item=>item.status==='stale')?'stale':'delayed',
    lastUpdated:new Date().toISOString(),errors,sources}
}
export async function getTerminalNews(query=''){
  if(!cached || Date.now()-loadedAt>300_000){
    if(!pending)pending=build().then(value=>{cached=value;loadedAt=Date.now();return value}).finally(()=>{pending=null})
    await pending
  }
  const needle=query.trim().toLocaleLowerCase(),counts=new Map()
  let domestic=0
  const items=cached.items.filter(item=>{
    if(item.category==='telegram'||telegramLink(item.url))return false
    if(item.bucket.startsWith('industry:'))return false
    if(needle&&!`${item.title} ${item.source}`.toLocaleLowerCase().includes(needle))return false
    const isDomestic=item.bucket.startsWith('domestic:')
    const cap=item.bucket==='policy'?10:20
    if((counts.get(item.bucket)||0)>=cap || (isDomestic&&domestic>=60))return false
    counts.set(item.bucket,(counts.get(item.bucket)||0)+1)
    if(isDomestic)domestic++
    return true
  }).slice(0,170).map(({bucket,...item})=>item)
  // Reserve space per sector before merging, so busy general feeds cannot hide
  // all of an industry's stories. A cross-sector story can appear in both tabs.
  const selected=new Map(items.map(item=>[item.url,item]))
  for(const [sector] of SECTOR_RULES){
    for(const market of ['KR','GLOBAL'])for(const kind of ['news','leadership']){
      const rows=cached.items.filter(item=>item.sectors.includes(sector)&&item.market===market&&item.kind===kind&&(!needle||`${item.title} ${item.source}`.toLocaleLowerCase().includes(needle))).slice(0,kind==='leadership'?10:20)
      for(const {bucket,...item} of rows)selected.set(item.url,item)
    }
  }
  const catalog=[...selected.values()].sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0))
  return {...cached,items:catalog,query:needle,limits:{domestic:60,perDomesticSource:20,global:100,perGlobalSource:20,policy:10,perSector:60,total:350}}
}
export async function findTerminalNewsItem(url){
  if(telegramLink(url))return null
  await getTerminalNews()
  return cached.items.find(item=>item.url===url&&item.category!=='telegram')||null
}

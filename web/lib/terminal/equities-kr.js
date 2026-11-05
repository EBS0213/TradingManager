import {equityComparator} from './equity-sort.mjs'
import {enrichKoreanDetails} from './equities-kr-enrichment-data.mjs'
import {koreanFilingDetails} from './equities-kr-enrichment'
import {getSql} from '@/lib/db'
import {cachedEconomy} from './economy-cache'
import {koreanEquitySymbol,koreanQuote,koreanDetails,krNumber} from './equities-kr-data.mjs'
import {sectorEtfCatalog} from './sector-etfs-data.mjs'
export {koreanEquitySymbol} from './equities-kr-data.mjs'

const SOURCE={name:'네이버페이 증권',url:'https://stock.naver.com/domestic/market_cap'}
const TTL=15*60_000,PAGE_SIZE=100
let active=0,cooldown=0
const queue=[]
async function acquire(signal){
  if(signal.aborted)throw signal.reason
  if(active<4){active++;return}
  await new Promise((resolve,reject)=>{
    const item={resolve:()=>{signal.removeEventListener('abort',cancel);resolve()}}
    const cancel=()=>{const index=queue.indexOf(item);if(index>=0)queue.splice(index,1);reject(signal.reason)}
    signal.addEventListener('abort',cancel,{once:true});queue.push(item)
  })
}
async function request(url,deadline){
  if(cooldown>Date.now())throw new Error('제공처 요청 제한')
  await acquire(deadline)
  try{
    if(cooldown>Date.now())throw new Error('제공처 요청 제한')
    const response=await fetch(url,{cache:'no-store',headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'},signal:AbortSignal.any([deadline,AbortSignal.timeout(5000)])})
    if(response.status===429){cooldown=Date.now()+60000;throw new Error('제공처 요청 제한')}
    if(!response.ok)throw new Error(`한국 종목 자료 HTTP ${response.status}`)
    return await response.json()
  }finally{const next=queue.shift();if(next)next.resolve();else active--}
}
const pageUrl=(market,page)=>`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=${PAGE_SIZE}`
async function readPage(market,page,deadline){
  const data=await request(pageUrl(market,page),deadline)
  if(!Array.isArray(data.stocks)||data.page!==page||!Number.isInteger(data.totalCount)||data.totalCount<1||data.totalCount>20000)throw new Error('한국 전체 목록 형식 확인 실패')
  return data
}
async function universe(){
  return cachedEconomy('equity_kr_universe_v2',TTL,async()=>{
    const deadline=AbortSignal.timeout(25000),markets=['KOSPI','KOSDAQ']
    const first=await Promise.all(markets.map(market=>readPage(market,1,deadline)))
    const jobs=markets.flatMap((market,index)=>Array.from({length:Math.ceil(first[index].totalCount/PAGE_SIZE)-1},(_,i)=>({market,page:i+2})))
    const observations=markets.map((market,index)=>({market,data:first[index]}));let cursor=0
    await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{
      while(cursor<jobs.length){const job=jobs[cursor++];observations.push({market:job.market,data:await readPage(job.market,job.page,deadline)})}
    }))
    // A quote moving across a market-cap page boundary can appear twice during
    // a crawl. Re-read the affected pages once; never pretend a partial set is full.
    const seenPages=new Map(),retryPages=new Set()
    for(const observation of observations)for(const row of observation.data.stocks){
      const previous=seenPages.get(row.itemCode)
      if(previous){retryPages.add(previous);retryPages.add(observation)}
      else seenPages.set(row.itemCode,observation)
    }
    for(const observation of [...retryPages].slice(0,8)){
      observations.push({market:observation.market,data:await readPage(observation.market,observation.data.page,deadline)})
    }
    const rows=new Map(),reportedTotal=first.reduce((sum,data)=>sum+data.totalCount,0)
    for(const {market,data} of observations)for(const row of data.stocks){
      const normalized=koreanQuote(row,market)
      if(normalized)rows.set(normalized.symbol,normalized)
    }
    const series=[...rows.values()],complete=series.length===reportedTotal
    if(!series.length)throw new Error('한국 전체 목록 비어 있음')
    return {series,source:SOURCE,status:'delayed',fetchedAt:new Date().toISOString(),asOf:series.map(row=>row.asOf).filter(Boolean).sort().at(-1)||null,
      coverage:{observed:series.length,reported:reportedTotal,complete,markets:Object.fromEntries(markets.map((market,i)=>[market,first[i].totalCount]))},
      errors:complete?[]:['장중 순위 변동 또는 코드 형식 변경으로 제공처 총수와 관측 수가 다릅니다. 관측된 종목만 표시합니다.'],
      note:`네이버 KOSPI·KOSDAQ 전체 페이지 관측 · 주식·ETF·ETN 제공처 분류 · 15분 캐시${complete?'':' · 전체 수집 수 확인 필요'}`}
  })
}
export async function koreanEquityList({q='',page=1,pageSize=50,sort='volume',kind='all',sector=null}={}){
  const data=await universe(),needle=q.trim().toLocaleUpperCase(),catalog=data.series.filter(row=>kind!=='etf'||row.kind==='etf')
  const sectors=sector===null?null:sectorEtfCatalog(catalog)
  const available=sectors?.items||catalog
  const rows=available.filter(row=>(sector===null||sector==='all'||row.sector===sector)&&`${row.symbol} ${row.name}`.toLocaleUpperCase().includes(needle))
  const cmp=equityComparator(sort)
  rows.sort((a,b)=>Number(b.symbol===needle)-Number(a.symbol===needle)||cmp(a,b)||a.symbol.localeCompare(b.symbol))
  const size=Number.isInteger(pageSize)&&pageSize>0?Math.min(pageSize,100):50,pages=Math.max(1,Math.ceil(rows.length/size)),actualPage=Math.max(1,Math.min(Number.isInteger(page)?page:1,pages))
  return {items:rows.slice((actualPage-1)*size,actualPage*size).map(({value,...row})=>row),market:'KR',kind,total:available.length,matched:rows.length,page:actualPage,pageSize:size,pages,
    source:SOURCE,asOf:data.asOf,status:data.stale?'stale':data.status,coverage:data.coverage,errors:data.errors||[],
    ...(sectors?{sector,sectorGroups:sectors.groups,totalEtfs:catalog.length}:{}),
    note:sectors?'한국 ETF 중 이름으로 산업·산업 테마를 식별한 목록입니다. 편입 종목이나 공식 산업 분류를 검증한 결과는 아닙니다. 관측 시세는 네이버페이 증권 기준입니다.':data.note}
}
let snapshotMemo=null,snapshotPending=null
async function snapshot(){
  if(!process.env.DATABASE_URL)return {stamp:null,rows:new Map()}
  if(snapshotMemo&&Date.now()-snapshotMemo.at<300000)return snapshotMemo
  if(!snapshotPending)snapshotPending=(async()=>{
    let timer
    try{
      const result=await Promise.race([(async()=>{const sql=await getSql();return (await sql`SELECT stamp,payload FROM screener_snapshot WHERE market='KR' ORDER BY created_at DESC LIMIT 1`)[0]})(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2000)})])
      const payload=typeof result?.payload==='string'?JSON.parse(result.payload):result?.payload
      return snapshotMemo={at:Date.now(),stamp:result?.stamp||null,rows:new Map((Array.isArray(payload)?payload:[]).map(row=>[String(row['코드']||''),row]))}
    }catch{return {stamp:null,rows:new Map()}}finally{clearTimeout(timer)}
  })().finally(()=>{snapshotPending=null})
  return snapshotPending
}
export async function koreanEquityDetail(symbol){
  if(!koreanEquitySymbol(symbol))throw new RangeError('한국 종목코드 형식이 올바르지 않습니다.')
  // Direct detail lookup does not need to crawl the full universe first.
  const data=await cachedEconomy(`equity_kr_detail_v3_${symbol}`,TTL,async()=>{
    const deadline=AbortSignal.timeout(25000)
    const [basic,integrated,bars,meta,quarter,annual]=await Promise.allSettled([
      request(`https://m.stock.naver.com/api/stock/${symbol}/basic`,deadline),
      request(`https://m.stock.naver.com/api/stock/${symbol}/integration`,deadline),
      request(`https://api.stock.naver.com/chart/domestic/item/${symbol}?periodType=dayCandle&count=400`,deadline),snapshot(),
      request(`https://m.stock.naver.com/api/stock/${symbol}/finance/quarter`,deadline),request(`https://m.stock.naver.com/api/stock/${symbol}/finance/annual`,deadline),
    ])
    const quote=basic.status==='fulfilled'?koreanQuote(basic.value):null
    if(!quote)throw new Error('한국 종목 시세를 확인하지 못했습니다.')
    let item=koreanDetails(quote,integrated.status==='fulfilled'?integrated.value:null,bars.status==='fulfilled'?bars.value:null,meta.status==='fulfilled'?meta.value.rows.get(symbol):null,meta.status==='fulfilled'?meta.value.stamp:null)
    if(item.kind==='stock'){
      let filing={}
      try{filing=await koreanFilingDetails(symbol,quarter.status==='fulfilled'?quarter.value:null,/우(?:[BC])?$/.test(item.name),deadline)}catch{/* Keep verified Naver financials when filings are unavailable. */}
      item=enrichKoreanDetails(item,{quarter:quarter.status==='fulfilled'?quarter.value:null,annual:annual.status==='fulfilled'?annual.value:null,...filing})
      const consensus=integrated.status==='fulfilled'?integrated.value.consensusInfo:null
      if(consensus?.itemCode===symbol)item.consensus={mean:krNumber(consensus.priceTargetMean),asOf:consensus.createDate,source:item.source}
    }
    return {series:[item],errors:[...(integrated.status==='rejected'?['종목 상세 정보를 받지 못했습니다.']:[]),...(bars.status==='rejected'?['일봉을 받지 못했습니다.']:[])]}
  })
  const {value,...item}=data.series[0]
  return {item:{...item,status:data.stale?'stale':item.status},errors:data.errors||[]}
}

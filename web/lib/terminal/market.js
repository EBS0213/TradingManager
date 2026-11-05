import { getSql } from '@/lib/db'
import { INDICES, REGIONS, marketItem, marketSnapshot, observedDailyHistory } from './data.mjs'

const TTL = 60_000
let cached = null, pending = null, fetchedAt = 0
const headers = {'User-Agent':'Mozilla/5.0', Referer:'https://finance.naver.com/', Accept:'application/json'}
async function getJson(url, timeout=4500) {
  const response = await fetch(url, {headers, cache:'no-store', signal:AbortSignal.timeout(timeout)})
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}
async function storedMarket() {
  if (!process.env.DATABASE_URL) return null
  try {
    const sql = await getSql()
    const rows = await sql`SELECT value, updated_at FROM screener_settings WHERE key='market'`
    return rows[0] || null
  } catch { return null }
}
async function build() {
  const stored = await storedMarket()
  const storedAt = stored?.updated_at ? new Date(stored.updated_at).toISOString() : null
  const fresh = storedAt && Date.now()-Date.parse(storedAt) < TTL
  const errors = []
  const observedAt = new Date().toISOString()
  const old = cached ? [...cached.americas,...cached.emea,...cached.asiaPacific] : []
  const items = await Promise.all(INDICES.map(async spec => {
    const [id,code,,name] = spec
    const domestic = code === 'KOSPI' || code === 'KOSDAQ'
    const storedQuote = domestic ? stored?.value?.indices?.find(x => x.code===code)
      : stored?.value?.world?.find(x => x.code===code || x.name===name)
    if (fresh && storedQuote?.price != null) return marketItem(spec,storedQuote,{asOf:storedAt})
    try {
      const url = domestic ? `https://m.stock.naver.com/api/index/${code}/basic`
        : `https://api.stock.naver.com/index/${encodeURIComponent(code)}/basic`
      const quote = await getJson(url)
      const history = domestic ? await getJson(`https://api.stock.naver.com/chart/domestic/index/${code}/minute`).catch(()=>[]) : []
      if (quote?.closePrice == null) throw new Error('시세 필드 없음')
      return marketItem(spec,quote,{asOf:observedAt,history})
    } catch {
      errors.push(`${id}: 시세 제공처 응답 없음`)
      if (storedQuote?.price != null) return marketItem(spec,storedQuote,{status:'stale',asOf:storedAt})
      const prior = old.find(x=>x.id===id && x.value!==null)
      return prior ? {...prior,dataStatus:'stale'} : marketItem(spec,null)
    }
  }))
  return marketSnapshot(items,{lastUpdated:observedAt,errors})
}
export async function getMarketData({force=false,includeDaily=false}={}) {
  let data
  if (!force && cached && Date.now()-fetchedAt<TTL) data=cached
  else {
    if (!pending) pending = build().then(value => {cached=value;fetchedAt=Date.now();return value}).finally(()=>{pending=null})
    data=await pending
  }
  return includeDaily ? withDailyHistory(data) : data
}

const DAILY_TTL=15*60_000
let dailyCache=null, dailyPending=null, dailyCheckedAt=0
async function readDailyCache(){
  if(!process.env.DATABASE_URL)return null
  try{
    const sql=await getSql()
    const row=(await sql`SELECT value,updated_at FROM screener_settings WHERE key='terminal_daily_history'`)[0]
    if(row?.value?.version===1)return {entries:row.value.entries,checkedAt:new Date(row.updated_at).getTime()}
  }catch{/* Database caching is optional; public observed data remains available. */}
  return null
}
async function loadDailyHistory(data){
  const stored=await readDailyCache()
  if(stored && Date.now()-stored.checkedAt<DAILY_TTL){dailyCache=stored.entries;dailyCheckedAt=stored.checkedAt;return dailyCache}
  const old=dailyCache || stored?.entries || {}
  const entries={...old}
  const available=REGIONS.flatMap(region=>data[region]).filter(item=>item.value!==null)
  let next=0
  // At most four requests in flight. No periodic background task is started.
  await Promise.all(Array.from({length:Math.min(4,available.length)},async()=>{
    while(next<available.length){
      const item=available[next++]
      const domestic=['KOSPI','KOSDAQ'].includes(item.code)
      try{
        const body=await getJson(`https://api.stock.naver.com/chart/${domestic?'domestic':'foreign'}/index/${encodeURIComponent(item.code)}?periodType=dayCandle&count=60`,3000)
        const points=observedDailyHistory(body?.priceInfos,item)
        if(!points.length)throw new Error('일봉 없음')
        entries[item.id]={points,asOf:new Date().toISOString(),status:'delayed'}
      }catch{
        entries[item.id]=old[item.id]?.points?.length ? {...old[item.id],status:'stale'} : {points:[],asOf:null,status:'unavailable'}
      }
    }
  }))
  dailyCache=entries;dailyCheckedAt=Date.now()
  if(process.env.DATABASE_URL){try{
    const sql=await getSql(), value=JSON.stringify({version:1,entries})
    await sql`INSERT INTO screener_settings(key,value,updated_at) VALUES('terminal_daily_history',${value}::jsonb,now())
      ON CONFLICT(key) DO UPDATE SET value=${value}::jsonb,updated_at=now()`
  }catch{/* Cache persistence failure does not invent or change observations. */}}
  return entries
}
async function withDailyHistory(data){
  if(!dailyCache || Date.now()-dailyCheckedAt>=DAILY_TTL){
    if(!dailyPending)dailyPending=loadDailyHistory(data).finally(()=>{dailyPending=null})
    await dailyPending
  }
  return {...data,...Object.fromEntries(REGIONS.map(region=>[region,data[region].map(item=>{
    const entry=dailyCache?.[item.id]
    return {...item,dailyHistory:entry?.points||[],dailyHistoryGranularity:'day',
      dailyHistoryStatus:entry?.status||'unavailable',dailyHistoryAsOf:entry?.asOf||null}
  })])),dailyHistorySource:'NAVER Finance daily OHLC',dailyHistoryCacheSeconds:DAILY_TTL/1000}
}

export const refreshStatus = () => ({strategy:'request-driven',ttlSeconds:60,schedulerRunning:false,usesRedis:false,
  explanation:'시세는 요청 시 최대 분당 한 번 갱신합니다. 서버리스 인스턴스에 상시 타이머를 실행하지 않습니다.'})

import {equityComparator} from './equity-sort.mjs'
import {yahooEquityStatistics} from './yahoo-equity'
import {enrichUsEquity} from './yahoo-equity-data.mjs'
import {getSql} from '@/lib/db'
import {fetchUsDay,fetchUsOhlcv,lastUsDay,hasUS,usKey} from '@/lib/massive'
import {cachedEconomy} from './economy-cache'
import {equitySymbol,numeric,marketRows,financialProjection} from './equities-data.mjs'
import {sectorEtfCatalog} from './sector-etfs-data.mjs'

import {catalog} from '../local-market.mjs'
const SOURCE={name:'Yahoo Finance',url:'https://finance.yahoo.com'}
let snapshotMemo=null,snapshotPending=null
async function snapshot() {
  if(snapshotMemo&&Date.now()-snapshotMemo.at<300000)return snapshotMemo
  if(!snapshotPending)snapshotPending=(async()=>{
    let timer
    try {
      const data=await Promise.race([(async()=>{
        if(!process.env.DATABASE_URL)return null
        const sql=await getSql()
        return (await sql`SELECT stamp,payload FROM screener_snapshot WHERE market='US' ORDER BY created_at DESC LIMIT 1`)[0]
      })(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),12000)})])
      const rows=typeof data?.payload==='string'?JSON.parse(data.payload):data?.payload
      if(!data||!Array.isArray(rows))return {stamp:null,rows:new Map()}
      return snapshotMemo={at:Date.now(),stamp:data?.stamp||null,rows:new Map((Array.isArray(rows)?rows:[]).map(row=>[String(row['코드']||''),row]))}
    }catch{return {stamp:null,rows:new Map()}}finally{clearTimeout(timer)}
  })().finally(()=>{snapshotPending=null})
  return snapshotPending
}
async function universe() {
  if(!hasUS())throw new Error('미국 시세 연결이 설정되지 않았습니다.')
  return cachedEconomy('equity_universe_v1',3600000,async()=>{
    const days=[...new Set(Array.from({length:10},(_,i)=>lastUsDay(i)))].slice(0,6)
    let current=null,previous=null
    for(const day of days) {
      try {
        const observed=await fetchUsDay(day,{timeoutMs:6500})
        if(!current)current=observed;else {previous=observed;break}
      }catch{/* A holiday has no observation; try an earlier trading day. */}
    }
    if(!current)throw new Error('최근 미국장 시세를 받지 못했습니다.')
    const meta=await snapshot()
    return {series:marketRows(current,previous,meta.rows),day:current.day,previousDay:previous?.day||null,
      coverage:current.coverage,source:SOURCE,status:'delayed',fetchedAt:new Date().toISOString(),note:'로컬 수집이 완료된 미국 종목 일별 종가 · ETF 포함. 등락률은 직전 거래일 종가 대비입니다.'}
  })
}
async function securityCatalog(kind='all') {
 const items=await catalog();return {series:items.filter(x=>kind!=='etf'||x.kind==='etf'),fetchedAt:new Date().toISOString()}
}

function emptyQuote(meta,day) {
  return {...meta,value:null,price:null,open:null,high:null,low:null,volume:null,previousClose:null,change:null,changePercent:null,asOf:null,currency:'USD',source:SOURCE,status:'unavailable',history:[]}
}
export async function equityList({q='',page=1,pageSize=50,sort='volume',kind='all',sector=null}={}) {
  const [data,catalog,metaSnapshot]=await Promise.all([universe(),securityCatalog(kind==='stock'?'all':kind),snapshot()]),needle=q.trim().toUpperCase()
  const quotes=new Map(data.series.map(row=>[row.symbol,{...row,turnover:numeric(row.price)!==null&&numeric(row.volume)!==null?numeric(row.price)*numeric(row.volume):null,turnoverBasis:'close-times-volume'}]))
  const sectors=sector===null?null:sectorEtfCatalog(catalog.series)
  const all=(sectors?.items||catalog.series).map(meta=>({...emptyQuote(meta,data.day),...quotes.get(meta.symbol),marketCap:numeric(metaSnapshot.rows.get(meta.symbol)?.['시가총액']),name:meta.name,exchange:meta.exchange,kind:meta.kind,securityType:meta.securityType,sector:meta.sector||null}))
  const rows=all.filter(row=>(kind!=='stock'||row.kind==='stock')&&(sector===null||sector==='all'||row.sector===sector)&&`${row.symbol} ${row.name}`.toUpperCase().includes(needle))
  const cmp=equityComparator(sort)
  rows.sort((a,b)=>Number(b.symbol===needle)-Number(a.symbol===needle)||cmp(a,b)||a.symbol.localeCompare(b.symbol))
  const pages=Math.max(1,Math.ceil(rows.length/pageSize)),actualPage=Math.min(page,pages)
  return {items:rows.slice((actualPage-1)*pageSize,actualPage*pageSize).map(({value,...row})=>row),total:all.length,matched:rows.length,
    page:actualPage,pageSize,pages,market:'US',kind,coverage:data.coverage,source:SOURCE,asOf:data.day,status:data.stale||catalog?.stale?'stale':data.status,
    ...(sectors?{sector,sectorGroups:sectors.groups,totalEtfs:catalog.series.length}:{}),
    note:sectors?'미국 ETF 중 이름으로 산업·산업 테마를 식별한 목록입니다. 편입 종목이나 공식 산업 분류를 검증한 결과는 아닙니다. 시세는 Yahoo 일별 종가입니다.':`미국 전체 상장 ${kind==='etf'?'ETF':'주식·ETF'} 목록 · Yahoo 일별 종가 · 미관측 가격은 — 표시`}
}
async function reference(symbol) {
 const item=(await catalog()).find(x=>x.symbol===symbol);if(!item)throw new Error('종목 목록 없음');
 return {...item,description:null,website:null,employees:null,industry:null,sharesOutstanding:null,marketCap:null}
}

export async function equityDetail(symbol) {
  if(!equitySymbol(symbol))throw new RangeError('종목코드 형식이 올바르지 않습니다.')
  const market=await universe()
  let quote=market.series.find(row=>row.symbol===symbol)
  if(!quote) {
    const meta=(await securityCatalog()).series.find(row=>row.symbol===symbol)
    if(!meta)return {item:null,errors:['미국 종목 목록에서 해당 종목을 찾지 못했습니다.']}
    quote=emptyQuote(meta,market.day)
  }
  const data=await cachedEconomy(`equity_detail_v3_${market.day}_${symbol}`,3*3600000,async()=>{
    const [bars,profile,meta,yahoo]=await Promise.allSettled([fetchUsOhlcv(symbol,400,{timeoutMs:12000}),reference(symbol),snapshot(),yahooEquityStatistics(symbol)])
    const history=bars.status==='fulfilled'?bars.value.map(row=>({time:`${row.d.slice(0,4)}-${row.d.slice(4,6)}-${row.d.slice(6,8)}`,value:row.c,open:row.o,high:row.h,low:row.l,close:row.c,volume:row.v,isComplete:true})).filter(row=>row.time<=market.day):[]
    const details=profile.status==='fulfilled'?profile.value:null
    const item={...quote,name:details?.name||quote.name,marketCap:details?.marketCap??null,exchange:details?.exchange||quote.exchange,
      kind:details?.kind||quote.kind,history,historyAsOf:history.at(-1)?.time||null,historyStatus:history.length?'delayed':'unavailable',profile:details,
      fundamentals:meta.status==='fulfilled'?financialProjection(meta.value.rows.get(symbol),meta.value.stamp):null}
    return {series:[enrichUsEquity(item,yahoo.status==='fulfilled'?yahoo.value:null)],
      errors:[...(bars.status==='rejected'?['일봉을 받지 못했습니다.']:[]),...(profile.status==='rejected'?['기업 개요를 받지 못했습니다.']:[]),...(yahoo.status==='rejected'?['Yahoo 추가 통계를 받지 못했습니다.']:[])]}
  })
  const {value,...item}=data.series[0]
  // The cached company/history is reusable, but its quote must not replace a newer market day.
  const {value:unused,history:empty,...latest}=quote
  return {item:{...item,...latest,name:item.name,kind:item.kind,exchange:item.exchange,marketCap:item.marketCap,status:market.stale||data.stale?'stale':quote.status},errors:data.errors||[]}
}

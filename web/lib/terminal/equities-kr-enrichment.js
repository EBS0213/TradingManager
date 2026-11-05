import {getSql} from '@/lib/db'
import {cachedEconomy} from './economy-cache'
import {naverFinancials,dartFinancials,dartShares} from './equities-kr-enrichment-data.mjs'

// Use the existing verified stock-code → DART-company map. Do not download the
// full corporation ZIP or scan historical reports on an interactive quote request.
export async function koreanFilingDetails(symbol,quarter,preferred,signal){
 const recent=naverFinancials(quarter,symbol)
 if(!recent||!process.env.DART_KEY||!process.env.DATABASE_URL)return {}
 const result=await cachedEconomy(`equity_kr_filing_v2_${symbol}_${recent.key}`,6*3600000,async()=>{
  let timer,corp
  try{
   const sql=await getSql(),rows=await Promise.race([sql`SELECT value->'map'->>${symbol} AS corp FROM screener_settings WHERE key='dart_corpmap' AND value->>'v'='2'`,new Promise(resolve=>{timer=setTimeout(()=>resolve([]),2000)})]);corp=rows[0]?.corp
  }finally{clearTimeout(timer)}
  if(!/^\d{8}$/.test(corp||''))return {series:[{}]}
  const year=recent.key.slice(0,4),report=({3:'11013',6:'11012',9:'11014',12:'11011'})[Number(recent.key.slice(4))]
  if(!report)return {series:[{}]}
  const read=async(endpoint,extra={})=>{
   const query=new URLSearchParams({crtfc_key:process.env.DART_KEY,corp_code:corp,bsns_year:year,reprt_code:report,...extra})
   const response=await fetch(`https://opendart.fss.or.kr/api/${endpoint}.json?${query}`,{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])})
   if(!response.ok)throw new Error(`공시 자료 HTTP ${response.status}`)
   const data=await response.json();if(!['000','013'].includes(data.status))throw new Error('공시 자료 조회 실패');return data
  }
  const [financials,shares,company]=await Promise.allSettled([
   (async()=>{if(report==='11011')return null;let fs='CFS',body=await read('fnlttSinglAcntAll',{fs_div:fs});if(body.status==='013'){fs='OFS';body=await read('fnlttSinglAcntAll',{fs_div:fs})}return dartFinancials(body.list,{year,report,fs})})(),
   read('stockTotqySttus').then(body=>dartShares(body,preferred)),read('company'),
  ])
  const calendarYear=company.status==='fulfilled'&&String(company.value.acc_mt)==='12'
  const entry={dart:calendarYear&&financials.status==='fulfilled'?financials.value:null,shares:calendarYear&&shares.status==='fulfilled'?shares.value:null,company:company.status==='fulfilled'&&company.value.status==='000'?{hm_url:company.value.hm_url}:null}
  if(!entry.dart&&!entry.shares&&!entry.company)throw new Error('공시 보완 자료 없음')
  return {series:[entry]}
 })
 return result.series[0]||{}
}

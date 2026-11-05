import {cachedEconomy} from './economy-cache'
import {equitySymbol} from './equities-data.mjs'
import {yahooSymbol,parseYahooStatistics,projectYahooStatistics} from './yahoo-equity-data.mjs'
let blockedUntil=0
export async function yahooEquityStatistics(symbol){
 if(!equitySymbol(symbol))throw new Error('지원하지 않는 Yahoo 종목코드')
 const data=await cachedEconomy(`yahoo_statistics_v1_${symbol}`,6*3600000,async()=>{
  if(blockedUntil>Date.now())throw new Error('Yahoo 조회 제한 중')
  const response=await fetch(`https://finance.yahoo.com/quote/${encodeURIComponent(yahooSymbol(symbol))}/key-statistics/`,{cache:'no-store',headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html'},signal:AbortSignal.timeout(7000)})
  if([401,403,429].includes(response.status)){blockedUntil=Date.now()+15*60_000;throw new Error('Yahoo 통계 조회 제한')}
  if(!response.ok)throw new Error(`Yahoo 통계 HTTP ${response.status}`)
  if(Number(response.headers.get('content-length'))>3_000_000)throw new Error('Yahoo 응답 크기 초과')
  const html=await response.text(),metrics=projectYahooStatistics(parseYahooStatistics(html,symbol),symbol)
  return {series:[metrics]}
 })
 return {...data.series[0],stale:Boolean(data.stale)}
}

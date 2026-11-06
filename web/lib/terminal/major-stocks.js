import {cachedEconomy} from './economy-cache'
import {loadMajorStocks} from './major-stocks-data.mjs'

export async function majorStocks() {
  const data=await cachedEconomy('major_us_stocks_v1',60_000,()=>loadMajorStocks(async url=>{
    const response=await fetch(url,{cache:'no-store',headers:{'User-Agent':'Mozilla/5.0',Referer:'https://stock.naver.com/'},signal:AbortSignal.timeout(6500)})
    if(!response.ok)throw new Error(`미국 주요주식 HTTP ${response.status}`)
    return response.json()
  }))
  const {series,...meta}=data
  return {...meta,items:series.map(({value,...row})=>row),status:data.stale?'stale':data.status}
}

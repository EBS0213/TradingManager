import {cachedEconomy} from './economy-cache'
import {oilHistoryRequest,parseOilHistoryCsv} from './oil-history-data.mjs'
import {agePrices} from './industry-price-data.mjs'

async function downloadHistory(kind) {
  const request=oilHistoryRequest(kind)
  const response=await fetch(request.url,{method:'POST',body:request.body,cache:'no-store',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'TradingManager/1.0 (personal market data reader)'}})
  if(!response.ok)throw new Error(`유가 CSV HTTP ${response.status}`)
  const reader=response.body.getReader(),chunks=[];let size=0
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)throw new Error('유가 CSV 크기 초과');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
  const data=parseOilHistoryCsv(new TextDecoder('euc-kr').decode(Buffer.concat(chunks)),kind)
  // A truncated recent-only download must not replace a complete history.
  if(data.coverage.from>'2009-01-01'||data.coverage.dates<1000)throw new Error('오피넷 장기 자료 범위 부족')
  return data
}
export async function getOilHistory(kind='all') {
  const results=await Promise.all((kind==='all'?['crude','products']:[kind]).map(async name=>{
    try{
      const data=agePrices(await cachedEconomy(`oil_history_v2_${name}`,6*3600000,()=>downloadHistory(name)))
      return {...data,kind:name,status:data.stale?'stale':'available',error:data.stale?'장기 자료를 갱신하지 못해 저장된 자료를 표시합니다.':null}
    }catch{return {kind:name,status:'unavailable',series:[],coverage:null,fetchedAt:null,error:'장기 가격 자료를 불러오지 못했습니다. 자동으로 재시도합니다.'}}
  }))
  return {feeds:results,series:results.flatMap(feed=>feed.series)}
}

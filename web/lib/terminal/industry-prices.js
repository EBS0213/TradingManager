import {cachedEconomy} from './economy-cache'
import {PRICE_SOURCES,parseDramPublic,parseDramContract,parseMemoryMarket,parseOpinet,agePrices} from './industry-price-data.mjs'

const HOUR=3600000
const feeds=[
  {id:'dram-public',view:'dram',ttl:HOUR,source:PRICE_SOURCES.dram,url:PRICE_SOURCES.dram.url,parse:parseDramPublic},
  {id:'dram-contract',view:'dram',ttl:12*HOUR,source:PRICE_SOURCES.contract,url:'https://www.dramexchange.com/Home/HomePrice?Source=NationalDramContract',parse:text=>parseDramContract(JSON.parse(text))},
  {id:'dram-memory',view:'dram',ttl:HOUR,source:PRICE_SOURCES.memory,url:PRICE_SOURCES.memory.url,parse:parseMemoryMarket},
  {id:'opinet-crude',view:'oil',ttl:HOUR,source:PRICE_SOURCES.crude,url:PRICE_SOURCES.crude.url,parse:text=>parseOpinet(text,'crude')},
  {id:'opinet-products',view:'oil',ttl:HOUR,source:PRICE_SOURCES.products,url:PRICE_SOURCES.products.url,parse:text=>parseOpinet(text,'products')},
]
async function fetchPrice(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store',headers:{'User-Agent':'TradingManager/1.0 (personal market data reader)','Accept':'text/html,application/json'}})
  if(!response.ok) throw new Error(`Price HTTP ${response.status}`)
  if(Number(response.headers.get('content-length'))>2_000_000) throw new Error('가격 응답 크기 초과')
  const reader=response.body.getReader(),chunks=[]
  let size=0
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break
      size+=value.length;if(size>2_000_000)throw new Error('가격 응답 크기 초과')
      chunks.push(value)
    }
  } finally {await reader.cancel().catch(()=>{})}
  return Buffer.concat(chunks).toString('utf8')
}
export function createIndustryPriceService({cache=cachedEconomy,fetcher=fetchPrice}={}) {
 return async function getIndustryPrices(view='all') {
  const results=await Promise.all(feeds.filter(feed=>view==='all'||feed.view===view).map(async feed=>{
    try {
      const data=agePrices(await cache(`industry_prices_v1_${feed.id}`,feed.ttl,async()=>feed.parse(await fetcher(feed.url))))
      return {...data,id:feed.id,source:feed.source,status:data.stale?'stale':data.series.some(row=>row.status==='available')?'available':'stale',
        error:data.stale?'새 가격 조회에 실패하여 마지막 수집 자료를 표시합니다.':null}
    } catch {
      return {id:feed.id,source:feed.source,series:[],status:'unavailable',fetchedAt:null,error:'가격을 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.'}
    }
  }))
  return {feeds:results,series:results.flatMap(feed=>feed.series),fetchedAt:new Date().toISOString()}
}

}
export const getIndustryPrices=createIndustryPriceService()

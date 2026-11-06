import {numeric,equitySymbol} from './equities-data.mjs'

export const US_EXCHANGES=['NASDAQ','NYSE','AMEX']
export function majorStockQuote(row,now=Date.now()) {
  const symbol=String(row?.symbolCode||'').replace(/ /g,'.')
  if(!equitySymbol(symbol)||row.stockEndType!=='stock'||row.currencyType?.code!=='USD')return null
  if(/preferred|preference|warrant|\brights\b|\bunits\b|\bprf\b/i.test(row.stockNameEng||''))return null
  const price=numeric(row.closePriceRaw??row.closePrice),marketCap=numeric(row.marketValueRaw)
  if(!(marketCap>0))return null
  const signed=value=>{
    const n=numeric(value)
    return n===null?null:['4','5'].includes(String(row.compareToPreviousPrice?.code))?-Math.abs(n):n
  }
  const change=signed(row.compareToPreviousClosePriceRaw??row.compareToPreviousClosePrice)
  const observed=typeof row.localTradedAt==='string'&&Number.isFinite(Date.parse(row.localTradedAt))?row.localTradedAt:null
  const value=price>0?price:null
  return {symbol,name:row.stockNameEng||row.stockName||symbol,kind:'stock',currency:'USD',exchange:row.stockExchangeType?.name||null,
    price:value,value,marketCap,change,changePercent:signed(row.fluctuationsRatioRaw??row.fluctuationsRatio),
    previousClose:value!==null&&change!==null?value-change:null,
    open:numeric(row.openPriceRaw??row.openPrice),high:numeric(row.highPriceRaw??row.highPrice),low:numeric(row.lowPriceRaw??row.lowPrice),
    volume:numeric(row.accumulatedTradingVolumeRaw??row.accumulatedTradingVolume),asOf:observed,history:[],
    status:value===null?'unavailable':!observed||now-Date.parse(observed)>5*86400000?'stale':'delayed',
    source:{name:'NAVER Finance',url:'https://stock.naver.com/worldstock'},changeBasis:'previous-trading-close',
    dataDelayMinutes:numeric(row.delayTime??row.stockExchangeType?.delayTime),marketStatus:row.marketStatus||null}
}
export async function loadMajorStocks(getJson,now=Date.now()) {
  // Include extra rows to remove preferred shares, warrants and units before ranking.
  // Require all exchanges so a source outage cannot silently change the ranking.
  const lists=await Promise.all(US_EXCHANGES.map(async exchange=>{
    const body=await getJson(`https://api.stock.naver.com/stock/exchange/${exchange}/marketValue?page=1&pageSize=60`)
    if(!Array.isArray(body?.stocks)||body.stocks.length<30)throw new Error(`${exchange} 시가총액 순위 없음`)
    const rows=body.stocks.map(row=>majorStockQuote(row,now)).filter(Boolean)
    if(rows.length<30)throw new Error(`${exchange} 시가총액 필드 없음`)
    return rows
  }))
  const unique=new Map()
  for(const row of lists.flat()) {
    const previous=unique.get(row.symbol)
    if(!previous||Date.parse(row.asOf)>Date.parse(previous.asOf))unique.set(row.symbol,row)
  }
  const series=[...unique.values()].sort((a,b)=>b.marketCap-a.marketCap||a.symbol.localeCompare(b.symbol)).slice(0,30)
  if(series.length!==30||series.every(row=>row.value===null))throw new Error('미국 주요주식 시세 없음')
  return {series,asOf:series.map(row=>row.asOf).filter(Boolean).sort().at(-1)||null,
    source:{name:'NAVER Finance',url:'https://stock.naver.com/worldstock'},fetchedAt:new Date(now).toISOString(),status:'delayed'}
}

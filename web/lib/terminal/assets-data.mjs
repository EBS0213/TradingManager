import {economyNumber, observationDate} from './economy-market-data.mjs'

const stocks = [
  ['AAPL','AAPL.O','Apple'],['MSFT','MSFT.O','Microsoft'],['NVDA','NVDA.O','NVIDIA'],
  ['AMZN','AMZN.O','Amazon'],['GOOGL','GOOGL.O','Alphabet'],['META','META.O','Meta Platforms'],
  ['TSLA','TSLA.O','Tesla'],['AVGO','AVGO.O','Broadcom'],['AMD','AMD.O','AMD'],
  ['NFLX','NFLX.O','Netflix'],['PLTR','PLTR.O','Palantir'],['ORCL','ORCL.K','Oracle'],
  ['CRM','CRM','Salesforce'],['JPM','JPM','JPMorgan Chase'],['V','V','Visa'],
  ['TSM','TSM','TSMC ADR'],['COST','COST.O','Costco'],['MU','MU.O','Micron'],
  ['INTC','INTC.O','Intel'],['QCOM','QCOM.O','Qualcomm'],
].map(([symbol,code,name])=>({symbol,code,name,kind:'stock'}))
const sectors = [
  ['XLK','정보기술'],['XLF','금융'],['XLE','에너지'],['XLV','헬스케어'],['XLI','산업재'],
  ['XLY','경기소비재'],['XLP','필수소비재'],['XLB','소재'],['XLU','유틸리티'],
  ['XLRE','부동산'],['XLC','커뮤니케이션'],
].map(([symbol,sector])=>({symbol,code:symbol==='XLRE'?'XLRE.K':symbol,name:`${sector} · ${symbol}`,sector,kind:'sector-etf'}))
const crypto = [
  ['BTC','Bitcoin'],['ETH','Ethereum'],['XRP','XRP'],['SOL','Solana'],['DOGE','Dogecoin'],
  ['ADA','Cardano'],['AVAX','Avalanche'],['LINK','Chainlink'],
].map(([symbol,name])=>({symbol,code:`KRW-${symbol}`,name,kind:'crypto'}))
export const ASSET_GROUPS = Object.freeze({stocks,sectors,crypto})
const round = value => value === null ? null : Number(value.toPrecision(12))
const signed = (value, code) => value === null ? null : ['4','5'].includes(String(code)) ? -Math.abs(value) : ['1','2'].includes(String(code)) ? Math.abs(value) : value
function dailyDate(raw) {
  const text=String(raw??'')
  const date=/^\d{8}$/.test(text)?`${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}`:text
  return /^\d{4}-\d{2}-\d{2}$/.test(date)?observationDate(date):null
}
export function naverAssetHistory(body, quote) {
  const quoteDate=observationDate(quote?.localTradedAt)?.slice(0,10)
  const closed=['CLOSE','CLOSED','END'].includes(quote?.marketStatus)
  const points=new Map()
  for(const row of Array.isArray(body?.priceInfos)?body.priceInfos:[]) {
    const time=dailyDate(row.localDate), close=economyNumber(row.closePrice)
    if(!time || close===null || close<=0)continue
    points.set(time,{time,value:close,close,open:economyNumber(row.openPrice),
      high:economyNumber(row.highPrice),low:economyNumber(row.lowPrice),volume:economyNumber(row.accumulatedTradingVolume),
      isComplete:quoteDate ? time<quoteDate || (time===quoteDate && closed) : null})
  }
  return [...points.values()].sort((a,b)=>a.time.localeCompare(b.time)).slice(-110)
}
function sourceFor(spec) {
  return spec.kind==='crypto'
    ? {name:'Upbit 공개 API',url:`https://upbit.com/exchange?code=CRIX.UPBIT.${spec.code}`}
    : {name:'네이버페이 증권',url:`https://stock.naver.com/worldstock/${spec.kind==='sector-etf'?'etf':'stock'}/${spec.code}`}
}
export function unavailableAsset(spec) {
  return {...spec,currency:spec.kind==='crypto'?'KRW':'USD',exchange:null,price:null,previousClose:null,
    change:null,changePercent:null,volume:null,volumeUnit:spec.kind==='crypto'?spec.symbol:'shares',
    marketCap:null,asOf:null,status:'unavailable',history:[],historyGranularity:'day',historyStatus:'unavailable',
    dataDelayMinutes:null,marketStatus:null,changeBasis:spec.kind==='crypto'?'UTC-day-close':'previous-close',
    source:sourceFor(spec),note:spec.kind==='sector-etf'?'미국 섹터 대표 ETF의 가격입니다. 업종 지수 자체의 수익률이 아닙니다.':
      spec.kind==='crypto'?'업비트 KRW 마켓 가격입니다. 등락은 UTC 전일 종가 대비이며 USD 가격으로 환산하지 않습니다.':'미국 주요 종목 고정 목록이며 시가총액 순위가 아닙니다.'}
}
export function naverAsset(spec, quote, body, now=Date.now()) {
  const result=unavailableAsset(spec)
  if(quote?.reutersCode!==spec.code)return result
  const price=economyNumber(quote.closePriceRaw??quote.closePrice), asOf=observationDate(quote.localTradedAt)
  const field=code=>economyNumber(quote.stockItemTotalInfos?.find(item=>item.code===code)?.value)
  const delta=signed(economyNumber(quote.compareToPreviousClosePriceRaw??quote.compareToPreviousClosePrice),quote.compareToPreviousPrice?.code)
  const previousClose=field('basePrice')??(price!==null&&delta!==null?round(price-delta):null)
  const ratio=signed(economyNumber(quote.fluctuationsRatioRaw??quote.fluctuationsRatio),quote.compareToPreviousPrice?.code)
  const history=body?.code===spec.code?naverAssetHistory(body,quote):[]
  const stale=!asOf || now-Date.parse(asOf)>5*86_400_000
  return {...result,currency:quote.currencyType?.code||'USD',exchange:quote.stockExchangeName||quote.stockExchangeType?.nameEng||null,
    price,previousClose,change:delta,changePercent:ratio,
    volume:economyNumber(quote.accumulatedTradingVolumeRaw)??field('accumulatedTradingVolume'),
    marketCap:economyNumber(quote.marketValueFullRaw),asOf,
    status:price===null?'unavailable':stale?'stale':'delayed',history,historyStatus:history.length?'available':'unavailable',
    dataDelayMinutes:economyNumber(quote.delayTime),marketStatus:quote.marketStatus||null,
    note:`${result.note} ${quote.delayTime>0?`${quote.delayTime}분 지연 시세`:'제공처 최근 시세 스냅샷'} · TM26은 5분 캐시를 사용합니다. 일봉은 거래소 현지 날짜이며 당일 봉은 미완료일 수 있습니다.`}
}
export function upbitAssetHistory(rows, now=Date.now()) {
  const today=new Date(now).toISOString().slice(0,10), points=new Map()
  for(const row of Array.isArray(rows)?rows:[]) {
    const time=dailyDate(String(row.candle_date_time_utc||'').slice(0,10)), close=economyNumber(row.trade_price)
    if(!time || close===null || close<=0)continue
    points.set(time,{time,value:close,close,open:economyNumber(row.opening_price),high:economyNumber(row.high_price),
      low:economyNumber(row.low_price),volume:economyNumber(row.candle_acc_trade_volume),isComplete:time<today})
  }
  return [...points.values()].sort((a,b)=>a.time.localeCompare(b.time)).slice(-60)
}
export function upbitAsset(spec, quote, rows, now=Date.now()) {
  const result=unavailableAsset(spec)
  if(quote?.market!==spec.code)return result
  const price=economyNumber(quote.trade_price), previousClose=economyNumber(quote.prev_closing_price)
  const stamp=economyNumber(quote.trade_timestamp)
  const asOf=stamp!==null && stamp>0 && stamp<=8.64e15?new Date(stamp).toISOString():null
  const history=upbitAssetHistory((Array.isArray(rows)?rows:[]).filter(row=>row.market===spec.code),now)
  const change=economyNumber(quote.signed_change_price), ratio=economyNumber(quote.signed_change_rate)
  return {...result,exchange:'UPBIT',price,previousClose,change,
    changePercent:ratio!==null?round(ratio*100):null,volume:economyNumber(quote.acc_trade_volume),
    volume24h:economyNumber(quote.acc_trade_volume_24h),marketCap:null,asOf,
    status:price===null?'unavailable':!asOf||now-Date.parse(asOf)>6*3600_000?'stale':'delayed',
    history,historyStatus:history.length?'available':'unavailable',dataDelayMinutes:0,marketStatus:'24/7',
    note:`${result.note} 거래량은 UTC 당일 누적이며 volume24h는 별도 24시간 누적입니다. 일봉도 UTC 날짜입니다. TM26은 5분 캐시를 사용합니다.`}
}

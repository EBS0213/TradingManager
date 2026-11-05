export const koreanEquitySymbol = value => typeof value === 'string' && /^[0-9][0-9A-Z]{5}$/.test(value)
export const krNumber = value => {
  if(value === null || value === undefined || value === '')return null
  const text=String(value).trim().replaceAll(',','').replace(/(?:원|배|%)$/,'')
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)&&Number.isFinite(Number(text))?Number(text):null
}
export function koreanAmount(value) {
  const direct=krNumber(value)
  if(direct!==null)return direct
  const text=String(value??'').replaceAll(',','').replace(/원$/,'').trim()
  if(!/^(?:\d+(?:\.\d+)?\s*(?:조|억|만)\s*)+(?:\d+(?:\.\d+)?)?$/.test(text))return null
  let total=0,last=0
  for(const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(조|억|만)/g)){
    total+=Number(match[1])*({조:1e12,억:1e8,만:1e4}[match[2]]);last=match.index+match[0].length
  }
  const remainder=text.slice(last).trim();if(remainder)total+=Number(remainder)
  return Number.isFinite(total)?total:null
}
const signed=(value,code)=>value===null?null:['4','5'].includes(String(code))?-Math.abs(value):['1','2'].includes(String(code))?Math.abs(value):value
export const krObservation = value => typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value))?value:null
export function koreanQuote(row,exchange=null,now=Date.now()) {
  const symbol=String(row?.itemCode||'')
  if(!koreanEquitySymbol(symbol)||typeof row.stockName!=='string')return null
  const parsedPrice=krNumber(row.closePriceRaw??row.closePrice),price=parsedPrice>0?parsedPrice:null
  const change=signed(krNumber(row.compareToPreviousClosePriceRaw??row.compareToPreviousClosePrice),row.compareToPreviousPrice?.code)
  const asOf=krObservation(row.localTradedAt),kind=['etf','etn'].includes(row.stockEndType)?row.stockEndType:'stock'
  const marketCap=krNumber(row.marketValueRaw)??(krNumber(row.marketValue)!==null?krNumber(row.marketValue)*1e8:null)
  return {symbol,name:row.stockName,kind,currency:'KRW',exchange:exchange||row.stockExchangeType?.nameEng||row.stockExchangeName||null,
    price,previousClose:price!==null&&change!==null?price-change:null,change,changePercent:signed(krNumber(row.fluctuationsRatio),row.compareToPreviousPrice?.code),
    open:krNumber(row.openPrice),high:krNumber(row.highPrice),low:krNumber(row.lowPrice),
    volume:krNumber(row.accumulatedTradingVolumeRaw??row.accumulatedTradingVolume),volumeUnit:'shares',
    turnover:krNumber(row.accumulatedTradingValueRaw)??(krNumber(row.accumulatedTradingValue)!==null?krNumber(row.accumulatedTradingValue)*1e6:null),
    marketCap,asOf,status:price===null?'unavailable':!asOf||now-Date.parse(asOf)>5*86400000?'stale':'delayed',
    dataDelayMinutes:krNumber(row.delayTime??row.stockExchangeType?.delayTime),marketStatus:row.marketStatus||null,history:[],
    source:{name:'네이버페이 증권',url:`https://stock.naver.com/domestic/${kind}/${symbol}`},
    changeBasis:'previous-trading-close',note:'네이버 KRX 관측 시세 · 전체 목록 15분 캐시 · 금액 KRW, 거래량 주 단위 · 실시간 연속 스트림 아님',value:price}
}
export function koreanHistory(body,quote) {
  if(body?.code!==quote?.symbol||!Array.isArray(body.priceInfos))return []
  const latest=quote.asOf?.slice(0,10),closed=['CLOSE','CLOSED','END','PREOPEN'].includes(quote.marketStatus),points=new Map()
  for(const row of body.priceInfos){
    const raw=String(row.localDate||''),time=/^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`:null,value=krNumber(row.closePrice)
    if(!time||!Number.isFinite(Date.parse(time))||new Date(time).toISOString().slice(0,10)!==time||value===null||value<=0)continue
    points.set(time,{time,value,close:value,open:krNumber(row.openPrice),high:krNumber(row.highPrice),low:krNumber(row.lowPrice),volume:krNumber(row.accumulatedTradingVolume),isComplete:latest?time<latest||(time===latest&&closed):null})
  }
  return [...points.values()].sort((a,b)=>a.time.localeCompare(b.time))
}
export function koreanFundamentals(body,snapshot,stamp) {
  const fields=new Map((body?.totalInfos||[]).map(row=>[row.code,row])),field=code=>krNumber(fields.get(code)?.value)
  const growth=value=>{const n=krNumber(value);return n===null||Math.abs(n)>=900?null:n*100}
  const sales=value=>{const n=krNumber(value);return n===null?null:n*1e8}
  const list=key=>String(snapshot?.[key]??'').split('|'),periods=list('실적분기목록'),revenues=list('매출분기목록'),epsValues=list('EPS분기목록'),rg=list('매출성장목록'),eg=list('EPS성장목록')
  const epsAllowed=snapshot?.['EPS출처']!=='순이익',quarterEPS=epsAllowed?krNumber(snapshot?.['EPS당분기']):null
  return {snapshotAsOf:snapshot?stamp:null,eps:quarterEPS??field('eps'),epsPrior:epsAllowed?krNumber(snapshot?.['EPS전년']):null,
    epsBasis:quarterEPS!==null?String(snapshot?.['EPS출처']||'TM26 저장 분기 EPS'):`네이버 제공 EPS${fields.get('eps')?.valueDesc?` (${fields.get('eps').valueDesc})`:''}`,
    epsGrowthPercent:quarterEPS!==null?growth(snapshot?.['EPS증가율']):null,revenue:sales(snapshot?.['매출당분기']),revenuePrior:sales(snapshot?.['매출전년']),revenueGrowthPercent:growth(snapshot?.['매출증가율']),revenueUnit:'KRW',
    high52:field('highPriceOf52Weeks'),low52:field('lowPriceOf52Weeks'),per:field('per'),pbr:field('pbr'),bps:field('bps'),dividendYieldPercent:field('dividendYieldRatio'),
    quarters:periods.filter(Boolean).slice(0,12).map((period,i)=>({period,revenue:sales(revenues[i]),eps:epsAllowed?krNumber(epsValues[i]):null,revenueGrowthPercent:growth(rg[i]),epsGrowthPercent:epsAllowed?growth(eg[i]):null})),
    source:{name:snapshot?'TM26 한국 스크리너 저장 실적 + 네이버페이 증권':'네이버페이 증권',url:`https://stock.naver.com/domestic/${body?.stockEndType==='etf'?'etf':'stock'}/${body?.itemCode||''}`},
    note:'저장 분기 매출은 억원에서 KRW로 환산했습니다. 네이버 EPS·PER의 기준 기간은 제공처 표기를 따릅니다.'}
}
export function koreanDetails(quote,integration,historyBody,snapshot=null,stamp=null) {
  const body=integration?.itemCode===quote.symbol?integration:null,fields=new Map((body?.totalInfos||[]).map(row=>[row.code,row.value]))
  const field=code=>krNumber(fields.get(code)),history=koreanHistory(historyBody,quote)
  return {...quote,open:field('openPrice')??quote.open,high:field('highPrice')??quote.high,low:field('lowPrice')??quote.low,
    volume:quote.volume??field('accumulatedTradingVolume'),marketCap:quote.marketCap??koreanAmount(fields.get('marketValue')??body?.etfKeyIndicator?.marketValue),
    turnover:quote.turnover??koreanAmount(fields.get('accumulatedTradingValue')),history,historyStatus:history.length?'delayed':'unavailable',historyAsOf:history.at(-1)?.time||null,historyGranularity:'day',
    profile:{name:quote.name,description:body?.description||snapshot?.['주요제품']||null,website:null,employees:null,exchange:quote.exchange,industry:snapshot?.['업종']||null,industryCode:body?.industryCode||null,
      sharesOutstanding:null,marketCap:quote.marketCap??koreanAmount(fields.get('marketValue')??body?.etfKeyIndicator?.marketValue),issuer:body?.etfKeyIndicator?.issuerName||null},
    fundamentals:koreanFundamentals(body,snapshot,stamp),etf:body?.etfKeyIndicator?{issuer:body.etfKeyIndicator.issuerName||null,nav:krNumber(body.etfKeyIndicator.nav),totalAssets:koreanAmount(body.etfKeyIndicator.totalNav),
      expenseRatioPercent:krNumber(body.etfKeyIndicator.totalFee),dividendYieldPercent:krNumber(body.etfKeyIndicator.dividendYieldTtm),underlyingIndex:fields.get('etfBaseIdx')||null,
      return1mPercent:krNumber(body.etfKeyIndicator.returnRate1m),return3mPercent:krNumber(body.etfKeyIndicator.returnRate3m),return1yPercent:krNumber(body.etfKeyIndicator.returnRate1y)}:null}
}

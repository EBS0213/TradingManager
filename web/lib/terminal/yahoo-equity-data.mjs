const finite=value=>typeof value==='number'&&Number.isFinite(value)
const raw=value=>finite(value?.raw)?value.raw:finite(value)?value:null
const percent=value=>{const number=raw(value);return number===null?null:number*100}
const date=value=>{const seconds=raw(value);if(seconds===null||seconds<=0)return null;const result=new Date(seconds*1000);return Number.isFinite(result.getTime())?result.toISOString():null}
export const yahooSymbol=symbol=>String(symbol).replaceAll('.','-')

// Read only JSON data already included in Yahoo's public statistics page.
// No script execution, authenticated API calls or formatted-number guessing.
export function parseYahooStatistics(html,symbol){
 if(typeof html!=='string'||html.length>3_000_000)throw new Error('Yahoo 응답 크기 확인 실패')
 const expected=yahooSymbol(symbol).toUpperCase()
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(!/type\s*=\s*["']application\/json["']/i.test(match[1])||!match[1].includes('data-sveltekit-fetched')||!match[1].includes('/quoteSummary/'))continue
  try{
   const envelope=JSON.parse(match[2]);if(envelope.status!==200||typeof envelope.body!=='string')continue
   const body=JSON.parse(envelope.body),results=body.quoteSummary?.result
   if(body.quoteSummary?.error||!Array.isArray(results)||results.length!==1)continue
   const data=results[0]
   if(String(data.price?.symbol).toUpperCase()!==expected||data.price?.currency!=='USD')continue
   if(!data.defaultKeyStatistics&&!data.financialData)continue
   return data
  }catch{/* Unrelated or malformed embedded data cannot supply financial metrics. */}
 }
 throw new Error('Yahoo 종목 통계의 식별 정보가 일치하지 않습니다.')
}
export function projectYahooStatistics(data,symbol,retrievedAt=new Date().toISOString()){
 if(String(data?.price?.symbol).toUpperCase()!==yahooSymbol(symbol).toUpperCase()||data.price.currency!=='USD')throw new Error('Yahoo 종목·통화 확인 실패')
 const stats=data.defaultKeyStatistics||{},summary=data.summaryDetail||{},financial=data.financialData||{}
 const source={name:'Yahoo Finance',url:`https://finance.yahoo.com/quote/${encodeURIComponent(yahooSymbol(symbol))}/key-statistics/`}
 const currency=financial.financialCurrency||null,financialAsOf=date(stats.mostRecentQuarter)?.slice(0,10)||null
 return {symbol,source,retrievedAt,marketAsOf:date(data.price.regularMarketTime),financialAsOf,
  per:raw(summary.trailingPE),pbr:raw(stats.priceToBook),enterpriseToEbitda:raw(stats.enterpriseToEbitda),dividendYieldPercent:percent(summary.dividendYield),
  high52:raw(summary.fiftyTwoWeekHigh),low52:raw(summary.fiftyTwoWeekLow),sharesOutstanding:raw(stats.sharesOutstanding),floatShares:raw(stats.floatShares),
  netMarginPercent:percent(financial.profitMargins??stats.profitMargins),operatingMarginPercent:percent(financial.operatingMargins),roePercent:percent(financial.returnOnEquity),
  consensus:{mean:raw(financial.targetMeanPrice),high:raw(financial.targetHighPrice),low:raw(financial.targetLowPrice),count:raw(financial.numberOfAnalystOpinions),currency,source,retrievedAt},
  trailing:{currency,revenue:raw(financial.totalRevenue),netIncome:raw(stats.netIncomeToCommon),eps:currency==='USD'?raw(stats.trailingEps):null,ebitda:raw(financial.ebitda),financialAsOf,source,retrievedAt}}
}
export function enrichUsEquity(item,yahoo){
 if(!yahoo||yahoo.symbol!==item.symbol||item.currency!=='USD'||item.kind==='etf')return item
 const original=item.fundamentals||{},fundamentals={...original},profile={...item.profile}
 const reported=finite(original.revenue)||finite(original.eps)||(original.quarters||[]).length>0
 for(const key of ['per','pbr','enterpriseToEbitda','dividendYieldPercent'])if(!finite(fundamentals[key])&&finite(yahoo[key]))fundamentals[key]=yahoo[key]
 fundamentals.marketSource=yahoo.source;fundamentals.marketAsOf=yahoo.marketAsOf
 if(!finite(original.high52)||!finite(original.low52)){
  fundamentals.high52=yahoo.high52;fundamentals.low52=yahoo.low52;fundamentals.rangeSource=yahoo.source;fundamentals.rangeAsOf=yahoo.marketAsOf
 }else{fundamentals.rangeSource=original.source;fundamentals.rangeAsOf=original.snapshotAsOf}
 for(const key of ['netMarginPercent','operatingMarginPercent','roePercent'])if(!finite(fundamentals[key])&&finite(yahoo[key]))fundamentals[key]=yahoo[key]
 fundamentals.profitabilityPeriod='최근 12개월 (TTM)';fundamentals.profitabilityAsOf=yahoo.financialAsOf;fundamentals.profitabilitySource=yahoo.source
 if(!finite(profile.sharesOutstanding)&&yahoo.sharesOutstanding>0){profile.sharesOutstanding=yahoo.sharesOutstanding;profile.source=yahoo.source}
 profile.floatShares=yahoo.floatShares;profile.floatSource=yahoo.source;profile.floatRetrievedAt=yahoo.retrievedAt
 const trailing=yahoo.trailing
 if(!reported&&trailing.currency==='USD'){
  Object.assign(fundamentals,{revenue:trailing.revenue,revenueUnit:'USD',eps:trailing.eps,epsBasis:'Yahoo 희석 EPS · 최근 12개월 (TTM)',netIncome:trailing.netIncome,financialPeriod:'최근 12개월 (TTM)',snapshotAsOf:yahoo.financialAsOf,source:yahoo.source})
 }
 // Foreign-currency ADR financials are displayed in their reported currency in
 // the TTM panel. They cannot become USD earnings or USD price targets.
 return {...item,profile,fundamentals,trailingFinancials:trailing,consensus:yahoo.consensus.currency==='USD'?yahoo.consensus:item.consensus,yahooStatus:yahoo.stale?'stale':'available'}
}

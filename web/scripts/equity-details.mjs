import {parseYahooStatistics,projectYahooStatistics,yahooSymbol} from '../lib/terminal/yahoo-equity-data.mjs'
const symbol=process.argv[2]||''
if(!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol))throw new Error('Invalid symbol')
const response=await fetch(`https://finance.yahoo.com/quote/${encodeURIComponent(yahooSymbol(symbol))}/key-statistics/`,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)})
if(!response.ok)throw new Error(`Yahoo HTTP ${response.status}`)
const source=parseYahooStatistics(await response.text(),symbol)
const metrics=projectYahooStatistics(source,symbol)
console.log(JSON.stringify({...metrics,market_cap:source.price?.marketCap?.raw||null,list_date:null}))

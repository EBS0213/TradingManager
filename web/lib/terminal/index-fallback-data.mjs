import {marketItem} from './data.mjs'

export const INDEX_FALLBACKS={'.GSPTSE':'^GSPTSE','.SSMI':'^SSMI','.INX':'^GSPC'}
const finite=x=>typeof x==='number'&&Number.isFinite(x)
export function yahooIndex(spec,body,now=Date.now()) {
  const symbol=INDEX_FALLBACKS[spec[1]],r=body?.chart?.result?.[0],meta=r?.meta
  if(!symbol||body?.chart?.error||meta?.symbol!==symbol||meta.instrumentType!=='INDEX'||!(meta.regularMarketPrice>0)||!finite(meta.regularMarketTime))throw new Error('지수 식별 정보 불일치')
  const time=new Date(meta.regularMarketTime*1000).toISOString()
  const day=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:meta.exchangeTimezoneName||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp*1000))
  const tradedDay=day(meta.regularMarketTime),q=r.indicators?.quote?.[0]||{},closed=finite(meta.currentTradingPeriod?.regular?.end)&&now>=meta.currentTradingPeriod.regular.end*1000
  const history=(r.timestamp||[]).flatMap((stamp,i)=>finite(stamp)&&finite(q.close?.[i])&&q.close[i]>0&&day(stamp)<=tradedDay?[{
    time:day(stamp),value:q.close[i],close:q.close[i],open:finite(q.open?.[i])?q.open[i]:null,high:finite(q.high?.[i])?q.high[i]:null,
    low:finite(q.low?.[i])?q.low[i]:null,volume:finite(q.volume?.[i])?q.volume[i]:null,isComplete:day(stamp)<tradedDay||closed,
  }]:[]).sort((a,b)=>a.time.localeCompare(b.time))
  // chartPreviousClose is the close before the entire range, not yesterday.
  const previous=history.filter(row=>row.time<tradedDay).at(-1)?.value
  const value=meta.regularMarketPrice,change=finite(previous)?value-previous:null
  const status=now-meta.regularMarketTime*1000>5*86400000?'stale':'delayed'
  return {...marketItem(spec,null),value,change,pctChange:finite(previous)&&previous>0?(value/previous-1)*100:null,
    time,asOf:new Date(now).toISOString(),lastUpdated:new Date(now).toISOString(),dataStatus:status,source:'Yahoo Finance',
    marketStatus:closed?'CLOSE':'OPEN',dailyHistory:history,dailyHistoryStatus:history.length?status:'unavailable',dailyHistoryAsOf:time}
}

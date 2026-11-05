export const numeric = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(String(value).replaceAll(',',''))) ? Number(String(value).replaceAll(',','')) : null
export const equitySymbol = value => typeof value === 'string' && /^[A-Z][A-Za-z0-9.\-^]{0,14}$/.test(value)
export function marketRows(current, previous, metadata = new Map()) {
  const prior = new Map((previous?.rows || []).map(row => [row.sym,row.c]))
  return current.rows.filter(row=>equitySymbol(row.sym)).map(row=>{
    const old=numeric(prior.get(row.sym)), price=numeric(row.c), meta=metadata.get(row.sym)||{}
    return {symbol:row.sym,name:meta['종목명']||row.sym,kind:'stock',currency:'USD',exchange:'US',
      turnover:price!==null&&numeric(row.v)!==null?price*numeric(row.v):null,turnoverBasis:'close-times-volume',
      sector:meta['업종']||null,price,open:numeric(row.o),high:numeric(row.h),low:numeric(row.l),volume:numeric(row.v),
      previousClose:old,change:old!==null&&price!==null?price-old:null,changePercent:old>0&&price!==null?(price/old-1)*100:null,
      asOf:current.day,status:'delayed',history:[],source:{name:'Yahoo Finance',url:'https://finance.yahoo.com'},
      changeBasis:'previous-trading-close',note:'로컬에 수집한 미국 일별 종가 · 미관측 종목 제외',value:price}
  })
}
export function financialProjection(row,stamp) {
  if(!row)return null
  const basis=String(row['EPS출처']||'미제공'), epsAllowed=basis!=='순이익'
  const growth=v=>{const n=numeric(v);return n===null||Math.abs(n)>=900?null:n*100}
  // The US SEC pipeline stores USD amounts without KR's 100-million-won scaling.
  const sales=v=>numeric(v)
  const values=key=>String(row[key]||'').split('|')
  const periods=values('실적분기목록'),revenues=values('매출분기목록'),eps=values('EPS분기목록'),rg=values('매출성장목록'),eg=values('EPS성장목록')
  return {snapshotAsOf:stamp,eps:epsAllowed?numeric(row['EPS당분기']):null,epsPrior:epsAllowed?numeric(row['EPS전년']):null,
    epsGrowthPercent:epsAllowed?growth(row['EPS증가율']):null,epsBasis:basis,revenue:sales(row['매출당분기']),revenuePrior:sales(row['매출전년']),
    revenueGrowthPercent:growth(row['매출증가율']),revenueUnit:'USD',high52:numeric(row['52주최고']),low52:numeric(row['52주최저']),
    quarters:periods.filter(Boolean).slice(0,12).map((period,i)=>({period,revenue:sales(revenues[i]),eps:epsAllowed?numeric(eps[i]):null,revenueGrowthPercent:growth(rg[i]),epsGrowthPercent:epsAllowed?growth(eg[i]):null})),
    source:{name:'TM26 미국 스크리너 저장 실적',url:'/#trading/dash'}}
}

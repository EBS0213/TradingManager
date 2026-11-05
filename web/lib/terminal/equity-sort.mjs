export function equityComparator(sort) {
 if(sort==='symbol')return (a,b)=>a.symbol.localeCompare(b.symbol)
 const field=sort==='up'||sort==='down'?'changePercent':sort==='marketCap'?'marketCap':sort==='turnover'?'turnover':'volume'
 return (a,b)=>{
  const av=a[field],bv=b[field],validA=typeof av==='number'&&Number.isFinite(av),validB=typeof bv==='number'&&Number.isFinite(bv)
  if(!validA||!validB)return Number(validB)-Number(validA)
  return sort==='down'?av-bv:bv-av
 }
}

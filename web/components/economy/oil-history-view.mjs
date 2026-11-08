export function aggregateOilPoints(points,frequency='daily') {
  if(frequency==='daily')return points
  const buckets=new Map()
  for(const point of points){
    let date=point.date
    if(frequency==='monthly')date=date.slice(0,7)
    else if(frequency==='annual')date=date.slice(0,4)
    else if(frequency==='weekly'){
      const monday=new Date(date+'T00:00:00Z');monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));date=monday.toISOString().slice(0,10)
    }else throw new Error('지원하지 않는 집계 주기')
    const bucket=buckets.get(date)||{sum:0,count:0}
    if(typeof point.value==='number'&&Number.isFinite(point.value)){bucket.sum+=point.value;bucket.count++}
    buckets.set(date,bucket)
  }
  return [...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([date,{sum,count}])=>({date,value:count?Number((sum/count).toFixed(4)):null}))
}

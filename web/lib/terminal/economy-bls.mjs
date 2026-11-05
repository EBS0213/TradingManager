// Independent implementation of the official BLS Public Data API contract.
// https://www.bls.gov/developers/api_signature_v2.htm
const DEFINITIONS = [
  ['LNS14000000', '미국 실업률', '%', '계절조정'],
  ['CUUR0000SA0', '미국 소비자물가지수', '1982–84=100', '계절조정하지 않은 CPI-U'],
  ['CES0000000001', '미국 비농업 고용', '천 명', '계절조정'],
]
const number = value => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && /^[-+]?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : null
const monthIndex = date => Number(date.slice(0,4))*12+Number(date.slice(5,7))-1

export function normalizeBls(body, now = new Date()) {
  const valid = body?.status === 'REQUEST_SUCCEEDED'
  const raw = Array.isArray(body?.Results?.series) ? body.Results.series : []
  const currentMonth = now.getUTCFullYear()*12+now.getUTCMonth()
  const series = DEFINITIONS.map(([id,name,unit,note]) => {
    const item = raw.find(row => row.seriesID === id)
    const points = valid && Array.isArray(item?.data) ? item.data.flatMap(row => {
      const value = number(row.value)
      if (!/^\d{4}$/.test(row.year) || !/^M(0[1-9]|1[0-2])$/.test(row.period) || value === null) return []
      const date = `${row.year}-${row.period.slice(1)}`
      return monthIndex(date) <= currentMonth ? [{date,value}] : []
    }).sort((a,b)=>a.date.localeCompare(b.date)) : []
    const unique = [...new Map(points.map(point=>[point.date,point])).values()]
    return finish({id:`BLS_${id}`,name,unit,note,points:unique,
      source:{name:'U.S. Bureau of Labor Statistics',url:`https://data.bls.gov/timeseries/${id}`}},currentMonth)
  })
  const cpi = series.find(row=>row.id==='BLS_CUUR0000SA0')
  const index = new Map(cpi.points.map(point=>[monthIndex(point.date),point.value]))
  const inflation = cpi.points.flatMap(point=>{
    const prior=index.get(monthIndex(point.date)-12)
    return prior && prior>0 ? [{date:point.date,value:(point.value/prior-1)*100}] : []
  })
  series.push(finish({id:'BLS_CPI_YOY',name:'미국 소비자물가 상승률',unit:'% (전년동월비)',points:inflation,
    note:'CPI-U 비계절조정 지수로 계산: (당월 / 전년 동월 − 1) × 100. 해당 월이 없으면 계산하지 않습니다.',source:cpi.source},currentMonth))
  const payroll = series.find(row=>row.id==='BLS_CES0000000001')
  const jobs = payroll.points.flatMap((point,i)=>{
    const prior=payroll.points[i-1]
    return prior && monthIndex(point.date)-monthIndex(prior.date)===1 ? [{date:point.date,value:point.value-prior.value}] : []
  })
  series.push(finish({id:'BLS_PAYROLL_CHANGE',name:'미국 비농업 고용 증감',unit:'천 명 (전월비)',points:jobs,
    note:'계절조정 비농업 고용의 전월 대비 증감. 잠정치와 과거 수치는 BLS 발표 시 개정될 수 있습니다.',source:payroll.source},currentMonth))
  return {series,fetchedAt:now.toISOString(),errors:valid?[]:['BLS 고용·물가 데이터를 가져오지 못했습니다.']}
}
function finish(spec,currentMonth) {
  const last=spec.points.at(-1), previous=spec.points.at(-2)
  const adjacent=previous && monthIndex(last.date)-monthIndex(previous.date)===1
  return {...spec,category:'macro',country:'USA',frequency:'월간',value:last?.value??null,
    previous:adjacent?previous.value:null,change:adjacent?last.value-previous.value:null,
    asOf:last?.date??null,status:!last?'unavailable':currentMonth-monthIndex(last.date)>3?'stale':'available'}
}
export async function getBlsEconomy() {
  try {
    const response=await fetch('https://api.bls.gov/publicAPI/v2/timeseries/data/',{
      method:'POST',headers:{'Content-Type':'application/json','User-Agent':'TM26 Research'},
      body:JSON.stringify({seriesid:DEFINITIONS.map(row=>row[0])}),signal:AbortSignal.timeout(8000),cache:'no-store',
    })
    if(!response.ok)throw new Error('BLS unavailable')
    return normalizeBls(await response.json())
  }catch{return normalizeBls(null)}
}

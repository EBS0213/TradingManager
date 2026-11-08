import {cachedEconomy} from '@/lib/terminal/economy-cache'
import {getOverviewEconomy} from '@/lib/terminal/economy-overview'
import {getCountryEconomy} from '@/lib/terminal/economy-country.mjs'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60
const COUNTRIES=new Set(['USA','KOR','JPN','CHN','DEU','GBR','IND','CAN','FRA','AUS','BRA','WLD'])
const HOUR=3600000
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':status===200?'public, max-age=0, s-maxage=300, stale-while-revalidate=600':'no-store'}})

function connectors(data) {
  const observations=data.series||[]
  const fresh=pattern=>observations.some(row=>row.status==='available' && pattern.test(row.source?.name||''))
  const sources=data.sources||[]
  return [
    {id:'worldbank',name:'World Bank',status:fresh(/World Bank/i)?'connected':sources.some(s=>/World Bank/i.test(s.name)&&s.status==='unavailable')?'unavailable':'on_request',description:'국가별 GDP·성장·물가·고용 등 연간 통계. 국가비교에서 조회합니다.',url:'https://data.worldbank.org/'},
    {id:'imf',name:'IMF DataMapper',status:fresh(/IMF/i)?'connected':sources.some(s=>/IMF/i.test(s.name)&&s.status==='unavailable')?'unavailable':'on_request',description:'World Bank 조회가 어려울 때 WEO 시계열을 조회합니다. 추정치가 포함될 수 있습니다.',url:'https://www.imf.org/external/datamapper/'},
    {id:'bls',name:'BLS',status:fresh(/Bureau of Labor|BLS/i)?'connected':'unavailable',description:'미국 월별 실업률·소비자물가·비농업 고용. 조회 결과를 12시간 캐시합니다.',url:'https://www.bls.gov/developers/'},
    {id:'treasury',name:'U.S. Treasury',status:fresh(/Treasury|재무부/i)?'connected':'unavailable',description:'미국 국채 만기별 금리. 조회가 지연되면 관측일과 저장 자료 상태를 표시합니다.',url:'https://home.treasury.gov/resource-center-data-chart-center/interest-rates'},
    {id:'ecb',name:'ECB · Frankfurter',status:fresh(/ECB|Frankfurter/i)?'connected':'unavailable',description:'중앙은행 일별 기준환율. 은행 고시환율·거래 시세와 구분합니다.',url:'https://frankfurter.dev/'},
    {id:'naver',name:'네이버페이 증권',status:fresh(/NAVER|네이버/i)?'connected':'unavailable',description:'환율·달러인덱스·WTI·브렌트유·금·은·구리·천연가스·곡물. 지연 시세와 선물 단위를 표시합니다.',url:'https://stock.naver.com/market/marketindex'},
    {id:'fred',name:'FRED · 한국은행 ECOS',status:'key_required',description:'기존 수집 자료를 관측일과 함께 제공합니다. 전체 시계열의 자동 갱신에는 수집기·API 키 설정이 필요합니다.',url:'https://fred.stlouisfed.org/'},
    {id:'fincept',name:'Fincept Cloud',status:'key_required',description:'별도 계정과 API 키를 사용하는 확장 데이터입니다. 현재 tm26에는 연결하지 않았습니다.',url:'https://docs.fincept.in/'},
  ]
}
export async function GET(request) {
  const url=new URL(request.url),view=url.searchParams.get('view')||'overview'
  if(!['overview','country'].includes(view))return json({error:'지원하지 않는 데이터 화면입니다.'},400)
  const country=(url.searchParams.get('country')||'KOR').toUpperCase()
  if(!COUNTRIES.has(country))return json({error:'지원하지 않는 국가입니다.'},400)
  try {
    let data
    if(view==='country')data=await cachedEconomy(`country_${country}`,24*HOUR,()=>getCountryEconomy(country))
    else data=await getOverviewEconomy()
    return json({...data,view,country:view==='country'?country:null,connectors:connectors(data),
      reference:{name:'FinceptTerminal 데이터 구성 참고',url:'https://github.com/Fincept-Corporation/FinceptTerminal',implementation:'TM26 공개 데이터 연결'}})
  }catch{return json({error:'경제 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},503)}
}

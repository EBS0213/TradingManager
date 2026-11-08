export const ECONOMY_CATEGORIES = [
  {id:'macro',name:'경제지표'}, {id:'rates',name:'금리·채권'},
  {id:'fx',name:'환율'}, {id:'commodities',name:'원자재'},
]
export const ECONOMY_GROUPS = [
  {id:'growth',category:'macro',name:'성장·국민계정'},
  {id:'prices',category:'macro',name:'물가'},
  {id:'employment',category:'macro',name:'고용·임금'},
  {id:'consumption',category:'macro',name:'소비·소득'},
  {id:'production',category:'macro',name:'생산·기업활동'},
  {id:'housing',category:'macro',name:'주택·부동산'},
  {id:'money',category:'macro',name:'통화·유동성'},
  {id:'fiscal',category:'macro',name:'재정·무역'},
  {id:'markets',category:'macro',name:'시장·금융여건'},
  {id:'other',category:'macro',name:'기타 경제지표'},
  {id:'policy',category:'rates',name:'정책금리·단기금리'},
  {id:'treasury',category:'rates',name:'국채·수익률'},
  {id:'spreads',category:'rates',name:'실질금리·금리차'},
  {id:'loans',category:'rates',name:'대출·모기지 금리'},
  {id:'fx',category:'fx',name:'환율·달러지수'},
  {id:'energy',category:'commodities',name:'에너지'},
  {id:'metals',category:'commodities',name:'금속'},
  {id:'agriculture',category:'commodities',name:'농산물'},
  {id:'commodities',category:'commodities',name:'기타 원자재'},
]
const byId = new Map(ECONOMY_GROUPS.map(group=>[group.id,group]))
const statusRank={available:0,stale:1,unavailable:2}
export const economyKey = row => `${row.country}:${row.id}`

export function economyDashboardGroup(row) {
  const id=String(row.id||''), text=`${id} ${row.name||''}`
  let group
  // Legacy snapshots sometimes classified mortgages and oil as macro indicators.
  // Assign their dashboard filters from the actual instrument, not that old bucket.
  if(/모기지|mortgage/i.test(text))group='loans'
  else if(row.category==='commodities'||/us_market:.*(?:WTI|브렌트|유가)/i.test(id)){
    group=/WTI|브렌트|유가|천연가스|CLcv1|LCOcv1|NGcv1/i.test(text)?'energy'
      :/금 |금$|은 |은$|구리|GCcv1|SIcv1|HGcv1|M04020000/i.test(text)?'metals'
      :/옥수수|소맥|대두|Ccv1|Wcv1|Scv1/i.test(text)?'agriculture':'commodities'
  }
  else if(row.category==='fx')group='fx'
  else if(row.category==='rates'){
    group=/spread|금리차|기대인플레|실질금리|스프레드|\dY_\d/i.test(text)?'spreads'
      :/국채|국고채|회사채|UST:|DGS\d|KTB_/i.test(text)?'treasury':'policy'
  }
  else if(/us_gdp:|FRED:(?:GDP|GDPC1|A191RL1Q225SBEA)(?:\s|$)|국내총생산|실질GDP/i.test(text))group='growth'
  else if(/us_cpi\d?:|CPI|PCE.*물가|PCEPILFE|PPI|소비자물가/i.test(text))group='prices'
  else if(/us_job:|UNRATE|PAYEMS|ICSA|BLS_(?:LNS|CES|PAYROLL)|고용|실업|임금|경제활동/i.test(text))group='employment'
  else if(/us_consume:|RSAFS|소매판매|개인소비|가처분|저축률|소비자심리/i.test(text))group='consumption'
  else if(/us_prod:|산업생산|가동률|자본재|내구재|제조업 생산|재고\/판매/i.test(text))group='production'
  else if(/us_house:|주택|건축 허가|부동산/i.test(text))group='housing'
  else if(/us_(?:money|fed|fedsec):|FRED:(?:M1SL|M2SL|M2V|BOGMBASE)(?:\s|$)|ECOS:M2(?:\s|$)|본원통화|유동성|지급준비|레포|TGA/i.test(text))group='money'
  else if(/us_(?:fiscal|trade):|경상수지|무역수지|수출|수입|정부 부채|재정수지/i.test(text))group='fiscal'
  else if(/us_(?:market|stress):|VIX|S&P|나스닥|다우|금융여건|금융스트레스|경기침체/i.test(text))group='markets'
  else group='other'
  return byId.get(group) ?? {id:"other",category:"macro",name:"기타 경제지표"}
}

export function filterEconomyDashboard(series,{categories=ECONOMY_CATEGORIES.map(row=>row.id),group='all',country='all',status='all',search='',sort='availability'}={}) {
  const selected=new Set(categories),term=search.trim().toLocaleLowerCase()
  return series.filter(row=>{
    const bucket=economyDashboardGroup(row)
    return selected.has(bucket.category)&&(group==='all'||group===bucket.id)
      &&(country==='all'||country===row.country)&&(status==='all'||status===row.status)
      &&(!term||`${row.name} ${row.id} ${row.country} ${row.source?.name||''} ${bucket.name}`.toLocaleLowerCase().includes(term))
  }).sort((a,b)=>{
    if(sort==='date')return String(b.asOf||'').localeCompare(String(a.asOf||''))||a.name.localeCompare(b.name,'ko')
    if(sort==='name')return a.name.localeCompare(b.name,'ko')
    return Number(a.value===null)-Number(b.value===null)||(statusRank[a.status]??3)-(statusRank[b.status]??3)||a.name.localeCompare(b.name,'ko')
  })
}
export function groupEconomyDashboard(series) {
  const groups=new Map(ECONOMY_GROUPS.map(group=>[group.id,{...group,items:[]}]))
  for(const row of series)groups.get(economyDashboardGroup(row).id).items.push(row)
  return [...groups.values()].filter(group=>group.items.length)
}
export const economyChangeUnit = unit => String(unit||'').trim().startsWith('%')?'%p':unit||''

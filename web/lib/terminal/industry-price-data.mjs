import {parseHTML} from 'linkedom'
import {economyNumber, economySeries, observationDate} from './economy-market-data.mjs'

export const PRICE_SOURCES = {
  dram: {name:'DRAMeXchange',url:'https://www.dramexchange.com/'},
  contract: {name:'DRAMeXchange',url:'https://www.dramexchange.com/Price/NationalContractDramDetail'},
  memory: {name:'MemoryMarket',url:'https://www.memorymarket.com/'},
  crude: {name:'오피넷 · 한국석유공사',url:'https://www.opinet.co.kr/glopcoilSelect.do'},
  products: {name:'오피넷 · 한국석유공사',url:'https://www.opinet.co.kr/glopopdSelect.do'},
}
const clean = node => (node?.textContent || '').replace(/\s+/g,' ').trim()
const number = value => economyNumber(String(value ?? '').replace(/\s*%$/,''))
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')
const cells = row => [...row.children].filter(node => /^(TD|TH)$/.test(node.tagName))
const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
function dramDate(text) {
  const match = /([A-Za-z]{3})\.?\s*(\d{1,2})\s+(\d{4})\s*,?\s*(\d{2}):(\d{2})\s*\(GMT\+8\)/.exec(text)
  if(!match) throw new Error('DRAM 기준시각 누락')
  const month = months.indexOf(match[1].toLowerCase())+1
  const stamp = `${match[3]}-${String(month).padStart(2,'0')}-${match[2].padStart(2,'0')}T${match[4]}:${match[5]}:00+08:00`
  if(!month || !observationDate(stamp)) throw new Error('DRAM 기준시각 오류')
  return stamp
}
function priceRow({id,name,group,frequency='daily',unit='USD/개',source,asOf,value,now,...extra}) {
  return {...economySeries({id,name,category:'commodities',country:'GLOBAL',unit,frequency,source},
    asOf && value !== null ? [{date:asOf,value}] : [],{now}), group,...extra}
}

export function parseDramPublic(html, now=Date.now()) {
  const {document} = parseHTML(html), series=[]
  // The provider reuses tb_ModuleSpotPrice for modules, GDDR and NAND wafers.
  // Select by the row's price link, never by that duplicate DOM id.
  for(const [path,group,frequency] of [
    ['Dram_Spot','dram-spot','daily'],['Module_Spot','module-spot','weekly'],['GDDR_Spot','gddr-spot','weekly'],
  ]) {
    const links=[...document.querySelectorAll(`tbody[id] a[href="/Price/${path}"]`)]
    if(!links.length) throw new Error(`${group} 가격 표 누락`)
    for(const link of links) {
      const td=cells(link.closest('tr')), name=clean(link)
      const values=td.slice(1,6).map(clean).map(number)
      if(td.length<7 || values.length!==5 || values.some(v=>v===null || v<0)) throw new Error(`${group} 가격 형식 변경`)
      const [periodHigh,periodLow,high,low,value]=values
      if(low>value || value>high || periodLow>periodHigh) throw new Error('DRAM 가격 범위 오류')
      const asOf=dramDate(clean(link.closest('.left_tab')?.querySelector('.tab_time')))
      series.push(priceRow({id:`DX:${group}:${slug(name)}`,name,group,frequency,source:PRICE_SOURCES.dram,asOf,value,now,
        periodHigh,periodLow,high,low,changePercent:number(clean(td[6])),access:'public'}))
    }
  }
  return {series,fetchedAt:new Date(now).toISOString()}
}

export function parseDramContract(data, now=Date.now()) {
  if(!Array.isArray(data) || !data.length) throw new Error('DRAM 계약가격 누락')
  const series=data.map(item=>{
    const name=String(item.show_name || '').trim(), value=number(item.show_avg), high=number(item.show_hi), low=number(item.show_lo)
    const asOf=observationDate(`${item.show_day}+08:00`)
    if(!/DDR|DIMM/i.test(name) || !asOf || [value,high,low].some(v=>v===null || v<0) || low>value || value>high)
      throw new Error('DRAM 계약가격 형식 변경')
    return priceRow({id:`DX:contract:${item.show_listid}`,name,group:'dram-contract',frequency:'monthly',source:PRICE_SOURCES.contract,
      asOf,value,high,low,now,changePercent:number(item.show_avg_change),lowChangePercent:number(item.show_lo_change),access:'public',
      period:`${asOf.slice(0,7)} ${Number(item.show_duration)===1?'상반월':'하반월'}`})
  })
  return {series,fetchedAt:new Date(now).toISOString()}
}

// Keep these market quotes separate from spot-session averages and OEM contracts.
export function parseMemoryMarket(html, now=Date.now()) {
  const {document}=parseHTML(html),series=[],seen=new Set()
  for(const [category,group,prefix] of [
    ['ddr','dram-quote',/^DDR[45]\s/],['rdimm','rdimm-quote',/^DDR[45]\sRDIMM\s/],
    ['udimm','udimm-quote',/^DDR[45]\sUDIMM\s/],['sodimm','sodimm-quote',/^DDR[45]\sSODIMM\s/],
    ['lpddr','lpddr-quote',/^LPDDR[45]X?\s/],
  ]) {
    const box=document.querySelector(`.product-price-box.${category}`),table=box?.querySelector('table')
    const headers=[...(table?.querySelectorAll('thead th')||[])].map(clean)
    if(headers.join('|')!=='Product Item|Latest|Previous|Change|Currency|Trend')throw new Error('메모리 가격 열 변경')
    const match=/Last update:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*\(UTC\+0\)/.exec(clean(box))
    const asOf=match&&observationDate(`${match[1]}T${match[2]}:00Z`)
    if(!asOf)throw new Error('메모리 가격 기준시각 누락')
    const rows=[...table.querySelectorAll('tbody tr')]
    if(!rows.length)throw new Error('메모리 가격 품목 누락')
    for(const row of rows) {
      const td=cells(row),link=td[0]?.querySelector('a'),name=clean(link)
      const code=new RegExp(`^/price/${category==='rdimm'?'ems':'ews'}/(\\d+)$`).exec(link?.getAttribute('href')||'')?.[1]
      const value=number(clean(td[1])),previous=number(clean(td[2]))
      const movement=/^([+-]?[\d,.]+)\s*\(\s*([+-]?[\d,.]+)%\s*\)$/.exec(clean(td[3]))
      if(td.length!==6||!code||seen.has(code)||!prefix.test(name)||clean(td[4])!=='USD'
        ||value===null||value<0||previous===null||previous<0||!movement)throw new Error('메모리 가격 형식 변경')
      const change=number(movement[1]),changePercent=number(movement[2])
      if(change===null||changePercent===null)throw new Error('메모리 가격 변동 오류')
      seen.add(code)
      series.push(priceRow({id:`MM:${category}:${code}`,name,group,frequency:'weekly',source:PRICE_SOURCES.memory,
        asOf,value,now,previous,change,changePercent,access:'public'}))
    }
  }
  return {series,fetchedAt:new Date(now).toISOString()}
}

export function parseOpinet(html, kind, now=Date.now()) {
  if(!['crude','products'].includes(kind)) throw new Error('지원하지 않는 유가 구분')
  const {document}=parseHTML(html), body=document.querySelector('#tbody2'), table=body?.closest('table')
  const headers=[...(table?.querySelectorAll('thead th')||[])].slice(1).map(clean)
  const expected=kind==='crude'?3:7
  if(!body || headers.length!==expected || !clean(table).includes(kind==='crude'?'Dubai':'나프타')) throw new Error('오피넷 가격 표 형식 변경')
  const endDate=document.querySelector('input[name="ENDDATE"]')?.value
  const century=/^\d{8}$/.test(endDate||'')?endDate.slice(0,2):String(new Date(now).getUTCFullYear()).slice(0,2)
  const observations=[...body.querySelectorAll('tr')].flatMap(row=>{
    const td=cells(row), match=/^(\d{2}|\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/.exec(clean(td[0]))
    if(!match) return []
    if(td.length!==expected+1) throw new Error('오피넷 가격 열 누락')
    const date=observationDate(`${match[1].length===2?century:''}${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`)
    if(!date) throw new Error('오피넷 기준일 오류')
    return [{date,values:td.slice(1).map(clean).map(number)}]
  })
  if(!observations.length) throw new Error('오피넷 관측값 누락')
  const codes=[...document.querySelectorAll('input[type="checkbox"][name="OILSRTCD"]')].map(n=>({code:n.value,name:clean(document.querySelector(`label[for="${n.id}"]`))}))
  const series=headers.map((name,index)=>{
    const code=codes.find(item=>item.name.replaceAll(' ','')===name.replaceAll(' ',''))?.code
    if(!code) throw new Error('오피넷 제품 코드 불일치')
    const points=observations.map(item=>({date:item.date,value:item.values[index]}))
    const item=economySeries({id:`OPINET:${kind}:${code}`,name:kind==='crude'?`${name} (${code==='001'?'현물':'선물'})`:name,
      category:'commodities',country:'GLOBAL',unit:'USD/배럴',frequency:'daily',source:PRICE_SOURCES[kind]},points,{now})
    const latest=observations.toSorted((a,b)=>a.date.localeCompare(b.date)).at(-1)
    // Do not silently substitute yesterday's value when the latest cell is blank.
    if(latest.values[index]===null) return {...item,value:null,previous:null,change:null,asOf:latest.date,status:'unavailable',group:`oil-${kind}`,access:'public'}
    return {...item,group:`oil-${kind}`,access:'public',changePercent:item.previous ? Number((item.change/item.previous*100).toFixed(4)):null}
  })
  if(!series.some(row=>row.value!==null)) throw new Error('오피넷 가격 전체 누락')
  return {series,fetchedAt:new Date(now).toISOString()}
}

export function agePrices(data, now=Date.now()) {
  return {...data,series:data.series.filter(row=>row.access!=='member_required').map(row=>{
    const maxDays=row.frequency==='daily'?7:row.frequency==='weekly'?21:row.frequency==='monthly'?45:200
    return row.value!==null && row.asOf && now-Date.parse(row.asOf)>maxDays*86400000 ? {...row,status:'stale'}:row
  })}
}

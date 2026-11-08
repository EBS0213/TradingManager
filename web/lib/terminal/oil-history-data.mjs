import {economyNumber,economySeries,observationDate} from './economy-market-data.mjs'
import {PRICE_SOURCES} from './industry-price-data.mjs'
export const OIL_PRODUCTS={
  crude:[['001','Dubai'],['002','Brent'],['003','WTI']],
  products:[['B001','휘발유(95RON)'],['B007','휘발유(92RON)'],['C001','등유'],['D009','경유(0.001%)'],['D008','경유(0.05%)'],['E001','고유황중유(180cst/3.5%)'],['F001','나프타']],
}
export function oilHistoryRequest(kind,now=Date.now()) {
  if(!Object.hasOwn(OIL_PRODUCTS,kind))throw new Error('지원하지 않는 유가 구분')
  const end=new Date(now).toISOString().slice(0,10),[year,month,day]=end.split('-')
  const body=new URLSearchParams({TERM:'D',STA_Y:'2008',STA_M:'01',STA_D:'01',END_Y:year,END_M:month,END_D:day,SEL_DIV:'div_dar',HOLIDAY_YN:'N'})
  OIL_PRODUCTS[kind].forEach(([code],index)=>body.set(`OILSRTCD${index+1}`,code))
  return {url:`https://www.opinet.co.kr/${kind==='crude'?'glopcoil':'glopopd'}_csv.do`,body:body.toString(),from:'2008-01-01',to:end}
}
function csvLine(line) {
  const cells=[];let cell='',quoted=false
  for(let i=0;i<line.length;i++){
    if(line[i]==='"'){
      if(quoted&&line[i+1]==='"'){cell+='"';i++}else quoted=!quoted
    }else if(line[i]===','&&!quoted){cells.push(cell.trim());cell=''}else cell+=line[i]
  }
  if(quoted)throw new Error('유가 CSV 따옴표 오류')
  cells.push(cell.trim());return cells
}
export function parseOilHistoryCsv(text,kind,now=Date.now()) {
  const products=OIL_PRODUCTS[kind];if(!products)throw new Error('지원하지 않는 유가 구분')
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/),header=csvLine(lines.shift()||'')
  if(header.length!==products.length+1||header[0]!=='기간'||products.some(([,name],i)=>header[i+1].replaceAll(' ','')!==name))throw new Error('유가 CSV 머리글 변경')
  const rows=new Map()
  for(const line of lines){
    if(!line.trim())continue
    const cells=csvLine(line),match=/^(\d{2}|\d{4})년(\d{2})월(\d{2})일$/.exec(cells[0])
    if(!match||cells.length!==header.length)throw new Error('유가 CSV 날짜·가격 열 변경')
    const date=observationDate(`${match[1].length===2?'20':''}${match[1]}-${match[2]}-${match[3]}`)
    if(!date||date<'2008-01-01'||date>new Date(now).toISOString().slice(0,10))throw new Error('유가 CSV 날짜 범위 오류')
    rows.set(date,cells.slice(1).map(value=>{const number=economyNumber(value);return number}))
  }
  const dates=[...rows.keys()].sort()
  if(!dates.length)throw new Error('유가 CSV 관측값 없음')
  const series=products.map(([code,label],index)=>{
    const points=dates.map(date=>({date,value:rows.get(date)[index]}))
    const item=economySeries({id:`OPINET:${kind}:${code}`,name:kind==='crude'?`${label} (${code==='001'?'현물':'선물'})`:label,
      category:'commodities',country:'GLOBAL',unit:'USD/배럴',frequency:'daily',source:PRICE_SOURCES[kind]},points,{now})
    return {...item,group:`oil-${kind}`,points}
  })
  if(!series.some(row=>row.value!==null))throw new Error('유가 CSV 가격 전체 누락')
  return {series,fetchedAt:new Date(now).toISOString(),coverage:{from:dates[0],to:dates.at(-1),dates:dates.length},kind}
}

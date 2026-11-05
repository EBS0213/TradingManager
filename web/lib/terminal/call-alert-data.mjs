import {fiscalPeriod} from './call-transcript-data.mjs'

// KST is an exact-hour offset from UTC, so its minute-of-hour is the same.
export function nextCallAlertTime(value=new Date()) {
  const now=new Date(value)
  if(!Number.isFinite(now.getTime()))throw new Error('발송 시각이 올바르지 않습니다.')
  const minute=now.getUTCMinutes()
  if(minute>=5&&minute<55)return now
  const next=new Date(now)
  if(minute>=55)next.setUTCHours(next.getUTCHours()+1)
  next.setUTCMinutes(5,0,0)
  return next
}

export function callAlertKey(item) {
  const period=fiscalPeriod(item?.quarter)
  if(!period||!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(item?.code||''))throw new Error('컨콜 식별 정보가 올바르지 않습니다.')
  return `${item.code}:${period.year}Q${period.quarter}`
}

const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const clip=(value,limit)=>String(value||'').length>limit?String(value).slice(0,limit-1)+'…':String(value||'')
export function formatCallAlert(item) {
  const lines=[`<b>컨퍼런스콜 · ${escape(item.name||item.code)} (${escape(item.code)})</b>`,
    `${escape(item.quarter)} · ${escape(item.date)}`,'',escape(clip(item.headline,200))]
  const numbers=(item.numbers||[]).slice(0,5)
  if(numbers.length)lines.push('',...numbers.map(n=>`• ${escape(clip(n.k,30))}: ${escape(clip(n.v,40))}${n.note?' — '+escape(clip(n.note,60)):''}`))
  if(item.summary)lines.push('',escape(clip(item.summary,1100)))
  lines.push('','한국어 전문·정리본은 TM26 로컬 프로그램에서 확인하세요.')
  return lines.join('\n')
}

// Rules are deliberately disabled until the user's existing recipient criteria are known.
export function callAlertEligible(item,rules) {
  if(!rules?.enabled)return {eligible:false,reason:'rules_not_configured',pending:true}
  if(rules.kind==='symbols'&&Array.isArray(rules.symbols)&&rules.symbols.length)
    return {eligible:rules.symbols.includes(item.code),reason:'symbol_rule'}
  throw new Error('기존 발송 대상 조건을 설정해야 합니다.')
}

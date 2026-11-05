import {createHash} from 'node:crypto'
import {callSourceUrl,fiscalPeriod} from './call-transcript-data.mjs'

export const transcriptDigest = text => createHash('sha256').update(text,'utf8').digest('hex')

// Keep complete documents separate from summary fields. Never truncate a transcript.
export function normalizeCallDocuments(value,item){
  if(value == null)return null
  const period=fiscalPeriod(item?.quarter),url=callSourceUrl(value.sourceUrl)
  if(!period||value.code!==item.code||value.year!==period.year||value.quarter!==period.quarter)
    throw new Error('전문의 종목·회계기간이 목록과 다릅니다.')
  if(!url||!['fool.com','www.fool.com'].includes(url.hostname))throw new Error('전문의 출처 주소가 올바르지 않습니다.')
  const text=value.original
  if(typeof text!=='string'||text.trim().length<500||text.length>500_000)throw new Error('영문 전문의 길이가 올바르지 않습니다.')
  const sha256=transcriptDigest(text)
  if(value.sha256!==sha256)throw new Error('영문 전문의 검증값이 일치하지 않습니다.')
  const originalParagraphs=text.split(/\n\s*\n/).filter(p=>p.trim())
  let translation=null
  if(value.translation!=null){
    const t=value.translation,p=t.paragraphs
    if(t.sourceSha256!==sha256||!Array.isArray(p)||p.length!==originalParagraphs.length
      ||p.some(s=>typeof s!=='string'||!s.trim()||s.length>30_000)||p.join('\n\n').length>700_000)
      throw new Error('한국어 전문의 원문 검증값 또는 문단 수가 일치하지 않습니다.')
    if(!/[가-힣]/.test(p.join('')))throw new Error('한국어 번역 본문이 필요합니다.')
    translation={language:'ko',paragraphs:p,sourceSha256:sha256,model:String(t.model||'').slice(0,100),generatedAt:String(t.generatedAt||'').slice(0,40)}
  }
  return {version:1,code:item.code,year:period.year,quarter:period.quarter,sourceUrl:url.href,
    title:String(value.title||'').slice(0,300),original:text,sha256,translation}
}

export function mergeCallDocuments(incoming,previous,item){
  const next=normalizeCallDocuments(incoming,item)
  let prior=null
  try{prior=normalizeCallDocuments(previous,item)}catch{/* Legacy invalid documents are not reused. */}
  if(!next)return prior
  if(!next.translation&&prior?.sha256===next.sha256)return {...next,translation:prior.translation}
  return next
}

export function documentTranscript(doc,item,language='en'){
  const translated=language==='ko',translation=doc.translation
  const paragraphs=translated?translation?.paragraphs||[]:doc.original.split(/\n\s*\n/).filter(p=>p.trim())
  return {status:paragraphs.length?'available':'unavailable',kind:'transcript',code:item.code,quarter:item.quarter,
    language:translated?'ko':'en',title:doc.title||`${item.name||item.code} · ${item.quarter}`,
    source:'The Motley Fool',url:doc.sourceUrl,paragraphs,transcript:paragraphs.join('\n\n'),
    sha256:doc.sha256,translationStatus:translation?'available':'missing',translation,
    note:translated?(translation?'영문 전문의 한국어 전체 번역입니다.':'한국어 전문이 아직 생성되지 않았습니다.'):'수집·저장된 영문 컨퍼런스콜 전문입니다.'}
}

import {getSql} from '@/lib/db'
import {readPublisherPage,extractArticle} from './news-article'
import {callSourceUrl,chooseCallSource,fiscalPeriod} from './call-transcript-data.mjs'
import {ensureCallArchive} from './call-archive'
import {normalizeCallDocuments,documentTranscript} from './call-documents.mjs'

function transcriptBody(parsed){
  if(parsed.status!=='available')return parsed
  const paragraphs=parsed.paragraphs||[]
  const full=paragraphs.findIndex(value=>/^Full Conference Call Transcript:?$/i.test(value))
  const prepared=paragraphs.findIndex(value=>/^Prepared (?:Remarks|Presentation):?$/i.test(value))
  const start=full>=0?full+1:prepared
  if(start<0)return {...parsed,note:'발행처 공개 기사 전체입니다. 콜 발언과 소개·요약이 함께 포함되어 있습니다.'}
  const body=paragraphs.slice(start)
  const end=body.findIndex(value=>/^(?:Call Participants|Participants|Duration|More .*Analysis|Should you invest|10 stocks we like|Motley Fool Returns)(?:\s*:|$)/i.test(value))
  const selected=end>=0?body.slice(0,end):body
  if(selected.join('').length<80)return {status:'unavailable'}
  return {...parsed,paragraphs:selected,note:parsed.note||'발행처의 콜 발언 구간을 표시합니다. 소개·기사 요약과 구분합니다.'}
}

async function findCall(code,quarter){
  const sql=await getSql()
  await ensureCallArchive(sql)
  const rows=await sql`SELECT payload FROM conference_call_archive
    WHERE code=${code} AND (${quarter}='' OR quarter=${quarter})
    ORDER BY call_date DESC LIMIT 1`
  return rows[0]?.payload||null
}
export function createCallTranscriptReader({findItem=findCall,readPage=readPublisherPage,now=()=>Date.now()}={}){
  const cache=new Map(),pending=new Map()
  return async function readCall({code='',quarter='',url='',language='en'}={}){
    code=String(code).trim().toUpperCase();quarter=String(quarter).trim()
    const result={status:'unavailable',kind:null,code,quarter,title:'',byline:'',source:'',url:'',paragraphs:[],transcript:'',note:'해당 분기의 공개 원자료를 찾지 못했습니다.'}
    if(!/^(?:[A-Z][A-Z0-9.\-]{0,9}|\d{6})$/.test(code)||quarter.length>60||String(url).length>2048)return result
    const item=await findItem(code,quarter)
    if(!item)return result
    let documents=null
    try{documents=normalizeCallDocuments(item.documents,item)}catch{/* Fall back to linked legacy sources. */}
    if(documents&&(!url||url===documents.sourceUrl))return documentTranscript(documents,item,language)
    if(language==='ko')return {...result,language:'ko',translationStatus:'missing',note:'한국어 전문이 아직 생성되지 않았습니다.'}
    const source=chooseCallSource(item,url)
    if(!source)return {...result,note:'연결된 공개 원문이 없습니다. 요약의 출처 링크를 확인해 주세요.'}
    const base={...result,kind:source.kind,quarter:item.quarter,title:`${item.name||code} · ${item.quarter}`,source:source.kind==='transcript'?'The Motley Fool':'SEC EDGAR',url:source.url}
    const key=`${code}|${item.quarter}|${source.url}`,saved=cache.get(key)
    if(saved&&now()-saved.at<600_000)return saved.value
    if(pending.has(key))return pending.get(key)
    if(pending.size>=3)return {...base,note:'다른 원문을 읽는 중입니다. 잠시 후 다시 시도해 주세요.'}
    const task=(async()=>{
      let value
      try{
        const page=await readPage(source.url,{validateUrl:callSourceUrl,userAgent:process.env.SEC_UA||'TradingManager tradingmanagerkr@gmail.com'})
        const article=page.restricted?{status:'restricted'}:extractArticle(page.html,page.url,{maxCharacters:240_000,maxParagraphs:1000})
        const parsed=source.kind==='transcript'?transcriptBody(article):article
        const actual=fiscalPeriod(parsed.title),wanted=fiscalPeriod(item.quarter)
        const ticker=new RegExp(`\\b${code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i')
        const matching=source.kind!=='transcript'||(actual&&wanted&&actual.year===wanted.year&&actual.quarter===wanted.quarter&&ticker.test(parsed.title))
        value=parsed.status==='available'&&matching?{...base,...parsed,url:page.url,
          transcript:source.kind==='transcript'?parsed.paragraphs.join('\n\n'):'',
          note:parsed.note||(source.kind==='transcript'?'발행처 공개 컨퍼런스콜 원문입니다. 번역·요약과 구분합니다.':'SEC 실적 공시 원자료입니다. 컨퍼런스콜 발언 전문은 아닙니다.')}:
          {...base,status:parsed.status==='restricted'?'restricted':'unavailable',note:parsed.status==='restricted'?'발행처의 접근 제한으로 본문을 표시할 수 없습니다. 원문 링크에서 확인해 주세요.':!matching?'원문 제목의 티커·회계기간이 요청한 기록과 일치하지 않습니다.':'공개 본문을 확인하지 못했습니다. 원문 링크에서 확인해 주세요.'}
      }catch{value={...base,note:'공개 본문을 불러오지 못했습니다. 원문 링크에서 확인해 주세요.'}}
      cache.delete(key);cache.set(key,{at:now(),value})
      while(cache.size>40)cache.delete(cache.keys().next().value)
      return value
    })().finally(()=>pending.delete(key))
    pending.set(key,task);return task
  }
}
export const getCallTranscript=createCallTranscriptReader()

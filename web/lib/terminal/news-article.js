import {lookup as lookupHost} from 'node:dns/promises'
import {request as httpsRequest} from 'node:https'
import {isIP} from 'node:net'
import {Readability} from '@mozilla/readability'
import {parseHTML} from 'linkedom'
import {findTerminalNewsItem} from './news'
import {TG_CHANNELS} from '@/lib/tgfeed'

const MAX_BYTES=2*1024*1024
const PUBLISHERS=['cnbc.com','federalreserve.gov','bbc.com','bbc.co.uk','theguardian.com','ft.com','marketwatch.com',
  'yna.co.kr','mk.co.kr','newsis.com','news1.kr','hankyung.com','edaily.co.kr','n.news.naver.com']
const text=(value,max=1000)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max)

export function articleUrl(raw,{telegram=true}={}) {
  if(typeof raw!=='string'||raw.length>2048||/[\u0000-\u0020\u007f]/.test(raw))return null
  try {
    const url=new URL(raw)
    if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))return null
    if(telegram&&url.hostname==='t.me'){
      const match=url.pathname.match(/^\/([A-Za-z0-9_]+)\/([1-9]\d*)$/)
      return match&&TG_CHANNELS.some(channel=>channel.id.toLowerCase()===match[1].toLowerCase())&&!url.search?url:null
    }
    return PUBLISHERS.some(host=>url.hostname===host||url.hostname.endsWith(`.${host}`))?url:null
  }catch{return null}
}

export function isPublicAddress(address) {
  const kind=isIP(address)
  if(kind===4){
    const [a,b,c]=address.split('.').map(Number)
    return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||
      (a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))||(b===88&&c===99)))||
      (a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113))
  }
  if(kind===6){
    const [first,second]=address.toLowerCase().split(':').map(part=>parseInt(part||'0',16))
    // Only global unicast; reject mapped IPv4, local/multicast, documentation,
    // transition mechanisms and reserved protocol-assignment space.
    return first>=0x2000&&first<=0x3fff&&first!==0x2002&&
      !(first===0x2001&&(second<=0x01ff||second===0x0db8))&&!(first===0x3fff&&second<=0x0fff)
  }
  return false
}

async function resolvePublic(host,signal,lookup) {
  signal.throwIfAborted()
  let onAbort
  try {
    const addresses=await Promise.race([lookup(host,{all:true,verbatim:true}),new Promise((_,reject)=>{
      onAbort=()=>reject(new Error('조회 시간 제한'))
      signal.addEventListener('abort',onAbort,{once:true})
    })])
    if(!addresses.length||addresses.some(row=>!isPublicAddress(row.address)))throw new Error('공개 주소가 아닙니다')
    return addresses[0]
  } finally {if(onAbort)signal.removeEventListener('abort',onAbort)}
}

function readResponse(url,address,signal,request,userAgent) {
  return new Promise((resolve,reject)=>{
    // Pin the validated DNS result to the socket. Checking DNS then using fetch
    // would resolve again and leave a DNS-rebinding gap.
    const req=request(url,{method:'GET',agent:false,signal,
      lookup:(_host,options,callback)=>options?.all?callback(null,[address]):callback(null,address.address,address.family),
      headers:{'User-Agent':userAgent,Accept:'text/html,application/xhtml+xml','Accept-Encoding':'identity'}},res=>{
      const status=res.statusCode||0
      if(status>=300&&status<400){res.destroy();resolve({status,location:res.headers.location});return}
      if([401,402,403,429,451].includes(status)){res.destroy();resolve({status,restricted:true});return}
      if(status!==200){res.destroy();reject(new Error('원문 응답을 받지 못했습니다'));return}
      const contentType=String(res.headers['content-type']||'')
      if(!/^text\/html|^application\/xhtml\+xml/i.test(contentType)||
        (res.headers['content-encoding']&&res.headers['content-encoding']!=='identity')||
        Number(res.headers['content-length'])>MAX_BYTES){res.destroy();reject(new Error('지원하지 않는 원문 형식'));return}
      let size=0
      const chunks=[]
      res.on('data',chunk=>{
        size+=chunk.length
        if(size>MAX_BYTES){res.destroy();reject(new Error('원문 크기 제한'));return}
        chunks.push(chunk)
      })
      res.on('error',reject)
      res.on('aborted',()=>reject(new Error('원문 응답 중단')))
      res.on('end',()=>{
        const body=Buffer.concat(chunks)
        const charset=contentType.match(/charset=["']?([^\s;"']+)/i)?.[1]||
          body.subarray(0,8192).toString('ascii').match(/charset=["']?([a-z0-9_-]+)/i)?.[1]||'utf-8'
        let html
        try{html=new TextDecoder(charset).decode(body)}catch{html=new TextDecoder().decode(body)}
        resolve({status,html})
      })
    })
    req.on('error',reject)
    req.end()
  })
}

export async function readPublisherPage(raw,{lookup=lookupHost,request=httpsRequest,signal=AbortSignal.timeout(12_000),
  validateUrl=value=>articleUrl(value,{telegram:false}),userAgent='TM26PublicReader/1.0'}={}) {
  let url=validateUrl(raw)
  for(let redirects=0;url&&redirects<=3;redirects++){
    const address=await resolvePublic(url.hostname,signal,lookup)
    const response=await readResponse(url,address,signal,request,userAgent)
    if(response.status>=300&&response.status<400){
      if(!response.location)throw new Error('원문 이동 주소 없음')
      url=validateUrl(new URL(response.location,url).href)
      continue
    }
    return {...response,url:url.href}
  }
  throw new Error('원문 이동 주소 제한')
}

function restrictedDocument(document) {
  for(const script of document.querySelectorAll('script[type="application/ld+json"]')){
    try {
      const queue=[JSON.parse(script.textContent)]
      for(let count=0;queue.length&&count<3000;count++){
        const row=queue.pop()
        if(!row||typeof row!=='object')continue
        if(row.isAccessibleForFree===false||row.isAccessibleForFree==='false')return true
        for(const value of Object.values(row))if(value&&typeof value==='object')queue.push(value)
      }
    }catch{/* Unparseable metadata is never executed. */}
  }
  if([...document.querySelectorAll('[itemprop="isAccessibleForFree"]')].some(node=>(node.getAttribute('content')||node.textContent).trim().toLowerCase()==='false'))return true
  if(document.querySelector('#challenge-form,#cf-challenge-running,[data-testid="paywall"],.subscription-required'))return true
  return /^(just a moment|attention required|access denied|subscribe to read|구독 후 읽기)/i.test(text(document.title))
}

export function extractArticle(html,url,{maxCharacters=80_000,maxParagraphs=160}={}) {
  if(typeof html!=='string'||Buffer.byteLength(html)>MAX_BYTES)return {status:'unavailable'}
  // LinkeDOM parses inert markup: it does not execute scripts or load resources.
  const {document}=parseHTML(html)
  if(restrictedDocument(document))return {status:'restricted'}
  for(const node of document.querySelectorAll('script,style,iframe,object,embed,form,template,noscript,svg,[hidden],[aria-hidden="true"]'))node.remove()
  for(const node of document.querySelectorAll('[style]'))if(/display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style')||''))node.remove()
  const base=document.createElement('base');base.href=url;document.head.prepend(base)
  const article=new Readability(document,{maxElemsToParse:20000,charThreshold:200,serializer:element=>element}).parse()
  if(!article?.content)return {status:'unavailable'}
  let paragraphs=[...article.content.querySelectorAll('p,h2,h3,li')]
    .filter(node=>!node.querySelector('p,h2,h3,li')).map(node=>text(node.textContent,6000)).filter(Boolean)
  if(!paragraphs.length)paragraphs=String(article.textContent||'').split(/\n+/).map(line=>text(line,6000)).filter(Boolean)
  if(paragraphs.join('').length<80)return {status:'unavailable'}
  let chars=0
  const originalCount=paragraphs.length
  paragraphs=paragraphs.filter(paragraph=>{chars+=paragraph.length;return chars<=maxCharacters}).slice(0,maxParagraphs)
  return {status:'available',title:text(article.title,500),byline:text(article.byline,250),paragraphs,
    ...(paragraphs.length<originalCount?{note:'본문이 길어 일부 문단만 표시합니다. 전체 문서는 원문 링크에서 확인할 수 있습니다.'}:{})}
}

export function createArticleReader({findItem=findTerminalNewsItem,readPage=readPublisherPage,now=()=>Date.now()}={}) {
  const cache=new Map(),pending=new Map()
  const fallback=(item,status,note)=>({status,title:text(item?.title,500),byline:'',paragraphs:item?.summary?[text(item.summary,800)]:[],
    url:item?.url||'',source:item?.source||'',note})
  return async function getArticle(raw){
    const url=articleUrl(raw)
    if(!url)return fallback(null,'unavailable','지원하는 공개 기사 주소가 아닙니다.')
    let item
    try{item=await findItem(url.href)}catch{return fallback(null,'unavailable','뉴스 목록을 확인할 수 없습니다.')}
    if(!item)return fallback(null,'unavailable','현재 뉴스 목록에 없는 기사입니다.')
    if(item.category==='telegram'&&url.hostname==='t.me')return {...fallback(item,'available','텔레그램 공식 공개 게시물 보기입니다.'),mode:'embed',embedUrl:`${url.origin}${url.pathname}?embed=1`}
    if(url.hostname==='t.me')return fallback(item,'unavailable','공개 채널 게시물을 확인할 수 없습니다.')
    const saved=cache.get(url.href)
    if(saved&&now()-saved.at<600_000)return saved.value
    if(pending.has(url.href))return pending.get(url.href)
    if(pending.size>=4)return fallback(item,'unavailable','다른 원문을 읽는 중입니다. 잠시 후 다시 시도해 주세요.')
    const task=(async()=>{
      let value
      try {
        const page=await readPage(url.href)
        const parsed=page.restricted?{status:'restricted'}:extractArticle(page.html,page.url)
        value=parsed.status==='available'?{...fallback(item,'available','발행처 공개 HTML에서 본문을 추출했습니다. 원문 구성과 다를 수 있습니다.'),...parsed,url:page.url}:
          fallback(item,parsed.status,parsed.status==='restricted'?'발행처가 구독·로그인 또는 접근 확인을 요구합니다. 공개 요약과 원문 링크를 표시합니다.':'공개 본문을 확인하지 못했습니다. 제공된 요약과 원문 링크를 표시합니다.')
      }catch{value=fallback(item,'unavailable','공개 본문을 불러오지 못했습니다. 제공된 요약과 원문 링크를 표시합니다.')}
      cache.delete(url.href);cache.set(url.href,{at:now(),value})
      while(cache.size>100)cache.delete(cache.keys().next().value)
      return value
    })().finally(()=>pending.delete(url.href))
    pending.set(url.href,task)
    return task
  }
}
export const getNewsArticle=createArticleReader()

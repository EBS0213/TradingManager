import {createRequire} from 'node:module'
const require=createRequire(new URL('../../web/package.json',import.meta.url))
const {parseHTML}=require('linkedom')
import {publisherUrl,googleReaderUrl,resolveGoogleNewsUrl} from '../../web/lib/terminal/news-publishers.mjs'
export {publisherUrl}
const headers={'User-Agent':'Mozilla/5.0',Accept:'text/html'}
async function originalUrl(raw){
  if(publisherUrl(raw))return raw
  return resolveGoogleNewsUrl(raw,async(url,options={})=>{
    if(!googleReaderUrl(url))throw new Error('Unsupported news resolver URL')
    const response=await fetch(url,{...options,headers:{...headers,...(options.body?{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}:{})},redirect:'error',signal:AbortSignal.timeout(7000)})
    if(!response.ok||Number(response.headers.get('content-length'))>2000000)throw new Error('News resolver unavailable')
    const chunks=[];let size=0
    for await(const chunk of response.body){size+=chunk.length;if(size>2000000)throw new Error('News resolver size limit');chunks.push(chunk)}
    return {html:Buffer.concat(chunks).toString('utf8')}
  })
}
async function summary(raw){
  let url=publisherUrl(raw)
  for(let i=0;url&&i<4;i++){
    const r=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(7000)})
    if(r.status>=300&&r.status<400){url=publisherUrl(new URL(r.headers.get('location'),url).href);continue}
    if(!r.ok||!r.headers.get('content-type')?.includes('text/html'))return ''
    if(Number(r.headers.get('content-length'))>2000000)return ''
    const html=await r.text();if(html.length>2000000)return ''
    const {document}=parseHTML(html)
    if(/access denied|just a moment|subscribe to read/i.test(document.title))return ''
    if([...document.querySelectorAll('script[type="application/ld+json"]')].some(node=>/"isAccessibleForFree"\s*:\s*(?:false|"false")/.test(node.textContent)))return ''
    const meta=document.querySelector('meta[property="og:description"],meta[name="description"]')?.getAttribute('content')||''
    return meta.replace(/\s+/g,' ').trim().slice(0,800)
  }
  return ''
}
export async function enrichLeadership(items){
  const chosen=[]
  for(const sector of ['semiconductor','automotive','energy'])for(const market of ['KR','GLOBAL']){
    chosen.push(...items.filter(row=>row.kind==='leadership'&&row.sectors.includes(sector)&&row.market===market&&!row.summary).slice(0,2))
  }
  const candidates=[...new Set(chosen)];let cursor=0
  await Promise.all(Array.from({length:3},async()=>{while(cursor<candidates.length){const row=candidates[cursor++];try{const url=await originalUrl(row.url);if(url){const description=await summary(url);row.googleUrl=row.googleUrl||row.url;row.url=url;if(description)row.summary=description;row.coverage=description?'headline_and_publisher_description':'headline_only'}}catch{row.coverage='headline_only'}}}))
  return items
}

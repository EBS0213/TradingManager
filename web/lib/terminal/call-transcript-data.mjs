export function callSourceUrl(raw){
  if(typeof raw!=='string'||raw.length>2048||/[\u0000-\u0020\u007f]/.test(raw))return null
  try{
    const url=new URL(raw)
    if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))return null
    if(['www.fool.com','fool.com'].includes(url.hostname)&&/^\/earnings\/call-transcripts\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/?$/.test(url.pathname))return url
    if(['www.sec.gov','sec.gov'].includes(url.hostname)&&/^\/Archives\/edgar\/data\/\d+\/[\w-]+\/[^/]+\.html?$/i.test(url.pathname))return url
    return null
  }catch{return null}
}
export function fiscalPeriod(raw){
  const text=String(raw||'')
  const year=text.match(/\b(20\d{2})\b/)?.[1]
  const quarter=text.match(/\bQ([1-4])\b/i)?.[1]||text.match(/([1-4])\s*분기/)?.[1]
  return year&&quarter?{year:Number(year),quarter:Number(quarter)}:null
}
export function normalizeTranscriptSource(value){
  const url=callSourceUrl(value?.url)
  if(!url||!url.hostname.endsWith('fool.com')||!Number.isInteger(value.year)||value.year<1990||value.year>2100||![1,2,3,4].includes(value.quarter))return null
  return {url:url.href,publisher:'The Motley Fool',collector:value.collector==='foolcalls'?'foolcalls':'public-source',
    year:value.year,quarter:value.quarter,
    sha256:/^[a-f0-9]{64}$/.test(value.sha256||'')?value.sha256:null,
    upstreamCommit:/^[a-f0-9]{40}$/.test(value.upstreamCommit||'')?value.upstreamCommit:null}
}
export function chooseCallSource(item,requestedUrl=''){
  const transcript=normalizeTranscriptSource(item?.transcriptSource)
  const period=fiscalPeriod(item?.quarter)
  const sources=(Array.isArray(item?.sources)?item.sources:[]).flatMap(source=>{
    const url=callSourceUrl(source?.url)
    return url?[{url:url.href,label:String(source.label||''),kind:url.hostname.endsWith('fool.com')?'transcript':'filing'}]:[]
  })
  if(transcript&&period?.year===transcript.year&&period?.quarter===transcript.quarter)sources.unshift({url:transcript.url,label:'The Motley Fool · foolcalls 공개 원문',kind:'transcript'})
  if(requestedUrl)return sources.find(source=>source.url===requestedUrl)||null
  return sources.find(source=>source.kind==='transcript')||sources.find(source=>/EX[- ]?99\.?1|실적.*보도|earnings.*release/i.test(source.label))||sources[0]||null
}

export function retainTranscriptSource(incoming,previous){
  const period=fiscalPeriod(incoming?.quarter)
  const source=normalizeTranscriptSource(incoming?.transcriptSource)||normalizeTranscriptSource(previous?.transcriptSource)
  return source&&period?.year===source.year&&period?.quarter===source.quarter?source:null
}

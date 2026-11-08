// Shared by the industry collector and the in-app article reader.
export const NEWS_PUBLISHERS=['cnbc.com','federalreserve.gov','bbc.com','bbc.co.uk','theguardian.com','ft.com','marketwatch.com',
  'reuters.com','bloomberg.com','wsj.com','apnews.com','yna.co.kr','mk.co.kr','newsis.com','news1.kr','hankyung.com',
  'edaily.co.kr','etnews.com','etoday.co.kr','n.news.naver.com','chosun.com','sk.com','skhynix.co.kr','skhynix.com',
  'hyundai.com','nvidia.com','amd.com','shell.com','chevron.com','exxonmobil.com','aramco.com','koreaherald.com','koreatimes.co.kr','snu.ac.kr']

function httpsUrl(raw){
  if(typeof raw!=='string'||raw.length>2048||/[\u0000-\u0020\u007f]/.test(raw))return null
  try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')?u:null}catch{return null}
}
export function publisherUrl(raw){
  const u=httpsUrl(raw)
  return u&&NEWS_PUBLISHERS.some(host=>u.hostname===host||u.hostname.endsWith('.'+host))?u:null
}
export function googleNewsUrl(raw){
  const u=httpsUrl(raw)
  return u?.hostname==='news.google.com'&&/^\/(?:rss\/)?articles\/[A-Za-z0-9_-]+$/.test(u.pathname)&&
    [...u.searchParams.keys()].every(key=>['oc','hl','gl','ceid'].includes(key))?u:null
}
export function googleReaderUrl(raw){
  const u=httpsUrl(raw)
  return googleNewsUrl(raw)||(u?.hostname==='news.google.com'&&u.pathname==='/_/DotsSplashUi/data/batchexecute'&&!u.search?u:null)
}

// Google RSS URLs are envelopes, not article HTML. Resolve only after catalog
// membership is checked, then validate the returned publisher before fetching it.
export async function resolveGoogleNewsUrl(raw,readGoogle){
  const u=googleNewsUrl(raw)
  if(!u)return null
  const id=u.pathname.split('/').at(-1)
  const page=await readGoogle(`https://news.google.com/rss/articles/${id}?hl=en-US&gl=US&ceid=US:en`)
  const signature=page.html?.match(/data-n-a-sg="([^"]+)"/)?.[1]
  const stamp=page.html?.match(/data-n-a-ts="(\d+)"/)?.[1]
  if(!signature||!stamp)return null
  const request=['garturlreq',[['X','X',['X','X'],null,null,1,1,'US:en',null,1,null,null,null,null,null,0,1],'X','X',1,[1,1,1],1,1,null,0,0,null,0],id,Number(stamp),signature]
  const body=new URLSearchParams({'f.req':JSON.stringify([[['Fbv4je',JSON.stringify(request),null,'generic']]])}).toString()
  const response=await readGoogle('https://news.google.com/_/DotsSplashUi/data/batchexecute',{method:'POST',body})
  // Parse the RPC payload, never choose an unrelated URL elsewhere in the page.
  for(const line of String(response.html||'').split('\n')){
    if(!line.startsWith('['))continue
    try{for(const row of JSON.parse(line)){
      if(row?.[0]!=='wrb.fr'||row[1]!=='Fbv4je'||typeof row[2]!=='string')continue
      const result=JSON.parse(row[2])
      if(result[0]==='garturlres')return publisherUrl(result[1])?.href||null
    }}catch{/* Length prefixes and unrelated RPC messages are ignored. */}
  }
  return null
}

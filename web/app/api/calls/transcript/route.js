import {getCallTranscript} from '@/lib/terminal/call-transcript'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=30
export async function GET(request){
  const query=new URL(request.url).searchParams
  const language=query.get('lang')||query.get('language')||'en'
  if(!['en','ko'].includes(language))return Response.json({error:'지원하지 않는 언어입니다.'},{status:400})
  try{
    return Response.json(await getCallTranscript({code:query.get('code')||'',quarter:query.get('quarter')||'',url:query.get('url')||'',language}),
      {headers:{'Cache-Control':'no-store'}})
  }catch{return Response.json({error:'저장소 조회가 지연되고 있습니다. 다시 조회해 주세요.'},{status:503,headers:{'Cache-Control':'no-store'}})}
}

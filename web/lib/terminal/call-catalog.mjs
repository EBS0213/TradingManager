import {createHash} from 'node:crypto';

const publicHeaders={
  'Cache-Control':'public, max-age=0, must-revalidate',
  'CDN-Cache-Control':'public, max-age=30',
  'Vercel-CDN-Cache-Control':'public, s-maxage=30',
};
const privateHeaders={'Cache-Control':'no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store'};

export function catalogResponse(request,body,{cache=true,status=200}={}){
  const text=JSON.stringify(body);
  const etag='"'+createHash('sha256').update(text).digest('hex')+'"';
  const headers={...(cache?publicHeaders:privateHeaders),'Content-Type':'application/json; charset=utf-8',ETag:etag};
  if(cache&&request.headers.get('if-none-match')?.split(',').map(x=>x.trim().replace(/^W\//,'')).includes(etag))
    return new Response(null,{status:304,headers});
  return new Response(text,{status,headers});
}

export async function callCatalog(request,sql){
  const query=new URL(request.url).searchParams;
  if(query.get('view')==='index'){
    const rows=await sql`SELECT code,quarter,call_date,updated_at::text AS version,payload->>'madeAt' AS made_at
      FROM conference_call_archive WHERE payload->'pipeline'->>'id' IN ('foolcalls-codex-v1', 'local-transcript-v1')
      ORDER BY code,quarter`;
    const items=rows.map(row=>({code:row.code,quarter:row.quarter,date:row.call_date,updatedAt:row.version,madeAt:row.made_at}));
    return catalogResponse(request,{ok:true,version:1,total:items.length,items});
  }
  const code=(query.get('code')||'').trim().toUpperCase(),quarter=(query.get('quarter')||'').trim();
  if(!/^[A-Z0-9.\-]{1,20}$/.test(code)||!quarter||quarter.length>80)
    return catalogResponse(request,{ok:false,error:'종목·분기를 확인하세요.'},{status:400,cache:false});
  const rows=await sql`SELECT payload-'documents' AS item,updated_at::text AS version
    FROM conference_call_archive WHERE code=${code} AND quarter=${quarter}
      AND payload->'pipeline'->>'id' IN ('foolcalls-codex-v1', 'local-transcript-v1') LIMIT 1`;
  if(!rows.length)return catalogResponse(request,{ok:false,error:'게시 자료가 없습니다.'},{status:404,cache:false});
  return catalogResponse(request,{ok:true,item:rows[0].item,updatedAt:rows[0].version});
}

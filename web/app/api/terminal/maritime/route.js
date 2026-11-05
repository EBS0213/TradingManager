import {maritimeSnapshot,storeSnapshot,invalidateMaritime,queryFleet} from '@/lib/maritime/service'
import {filterVessels} from '@/lib/maritime/data.mjs'
import {readBody} from '@/lib/terminal/http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=30
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function GET(request){
 const query=new URL(request.url).searchParams
 const data=await maritimeSnapshot()
 if(query.get('view')==='sources')return json({ok:true,status:data.status,source:data.source,sources:data.sources,freight:data.freight})
 const fleet=await queryFleet(query)
 return json({...data,...fleet,note:query.get('hours')==='168'?'최근 7일 마지막 수신 위치 · 30분 이상 미갱신은 이전 관측':'최근 24시간 수신 위치 · 30분 이상 미갱신은 이전 관측',status:fleet.total?'observed':data.status})
}
export async function POST(request){
 if(!process.env.SCREENER_KEY||request.headers.get('x-screener-key')!==process.env.SCREENER_KEY)return json({ok:false,error:'인증이 필요합니다.'},401)
 let body;try{body=await readBody(request,2000000)}catch{return json({ok:false,error:'요청 형식 또는 크기 오류'},400)}
 try{const count=await storeSnapshot(body);invalidateMaritime();return json({ok:true,count})}catch{return json({ok:false,error:'자료 검증 또는 저장 실패'},422)}
}

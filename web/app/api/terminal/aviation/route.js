import {area} from '@/lib/aviation/data.mjs';
import {getSql} from '@/lib/db';
import {readBody} from '@/lib/terminal/http';
import {initializeTracks,recordTracks,readTrack} from '@/lib/aviation/track-store';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=30;
const source={name:'adsb.fi',url:'https://adsb.fi/',license:'개인·비상업적 이용'};
const json=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store, max-age=0','Pragma':'no-cache'}});
let ready;
async function database(){const sql=await getSql();if(!ready)ready=(async()=>{await sql`CREATE TABLE IF NOT EXISTS tm_aviation_snapshot (area_key TEXT PRIMARY KEY,lat DOUBLE PRECISION NOT NULL,lon DOUBLE PRECISION NOT NULL,requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),payload JSONB,updated_at TIMESTAMPTZ)`;await initializeTracks(sql)})().catch(e=>{ready=null;throw e});await ready;return sql}
function keyFor(lat,lon){return `${Math.round(lat)},${Math.round(lon)}`}
function authorized(req){return !!process.env.SCREENER_KEY&&req.headers.get('x-screener-key')===process.env.SCREENER_KEY}
export async function GET(request){
 const q=new URL(request.url).searchParams;
 if(q.has('track')){
  const id=q.get('track')?.toLowerCase();if(!/^~?[a-f0-9]{6}$/.test(id||''))return json({ok:false,error:'항공기 식별자를 확인하세요.'},400);
  try{const points=await readTrack(await database(),id);return json({ok:true,id,points,status:points.length>1?'observed':'pending'})}
  catch(e){console.error('aviation_track',e?.name);return json({ok:false,error:'항적 자료를 불러오지 못했습니다.'},503)}
 }
 let loc;try{loc=area(q)}catch{return json({ok:false,error:'지도 중심 좌표를 확인하세요.'},400)}
 if(q.get('view')==='sources'){try{const sql=await database();const rows=await sql`SELECT max(updated_at) AS updated_at FROM tm_aviation_snapshot`;const t=rows[0]?.updated_at;return json({ok:true,status:t?(Date.now()-new Date(t).getTime()<120000?'observed':'stale'):'pending',updatedAt:t||null,source},200)}catch{return json({ok:true,status:'unavailable',source})}}
 try{const sql=await database(),lat=Math.round(loc.lat),lon=Math.round(loc.lon),key=keyFor(lat,lon);
 const rows=await sql`INSERT INTO tm_aviation_snapshot(area_key,lat,lon,requested_at) VALUES(${key},${lat},${lon},now()) ON CONFLICT(area_key) DO UPDATE SET requested_at=now() RETURNING payload,updated_at`;
 const row=rows[0];if(!row.payload)return json({ok:true,status:'pending',aircraft:[],area:loc,source},200);
 const age=Date.now()-new Date(row.updated_at).getTime(),payload=row.payload;
 return json({...payload,source,area:loc,status:age>120000?'stale':payload.status,aircraft:(payload.aircraft||[]).map(a=>({...a,stale:Date.now()-Date.parse(a.asOf)>60000})),updatedAt:row.updated_at},200);
 }catch(e){console.error('aviation_storage',e?.name);return json({ok:true,status:'unavailable',aircraft:[],area:loc,source,error:'저장된 항공 자료를 불러오지 못했습니다.'})}
}
export async function POST(request){
 if(!authorized(request))return json({ok:false,error:'인증이 필요합니다.'},401);
 let body;try{body=await readBody(request,2000000)}catch{return json({ok:false,error:'요청 형식 오류'},400)}
 try{const sql=await database();if(body?.operation==='jobs'){
  const rows=await sql`SELECT area_key,lat,lon FROM tm_aviation_snapshot WHERE requested_at>now()-interval '10 minutes' AND (updated_at IS NULL OR updated_at<now()-interval '1 minute') ORDER BY updated_at ASC NULLS FIRST,requested_at DESC LIMIT 8`;
  return json({ok:true,jobs:rows});
 }
 if(body?.operation!=='publish'||!Number.isInteger(body.lat)||!Number.isInteger(body.lon)||Math.abs(body.lat)>85||Math.abs(body.lon)>180||!Array.isArray(body.aircraft)||body.aircraft.length>5000||!['observed','empty','partial'].includes(body.status))return json({ok:false,error:'자료 검증 실패'},422);
 const aircraft=body.aircraft;if(aircraft.some(a=>!/^~?[a-f0-9]{6}$/.test(a.id||'')||!Number.isFinite(a.lat)||Math.abs(a.lat)>90||!Number.isFinite(a.lon)||Math.abs(a.lon)>180||!Number.isFinite(Date.parse(a.asOf))||Date.parse(a.asOf)>Date.now()+300000||Date.parse(a.asOf)<Date.now()-1800000))return json({ok:false,error:'항공 관측 자료 오류'},422);
 const payload={ok:true,status:body.status,aircraft,coverage:Array.isArray(body.coverage)?body.coverage.slice(0,9):[],total:aircraft.length};
 const rows=await sql`UPDATE tm_aviation_snapshot SET payload=${JSON.stringify(payload)}::jsonb,updated_at=now() WHERE area_key=${keyFor(body.lat,body.lon)} RETURNING area_key`;
 await recordTracks(sql,aircraft);
 return json({ok:true,updated:rows.length});
 }catch(e){console.error('aviation_update',e?.name);return json({ok:false,error:'항공 자료 저장 실패'},500)}
}

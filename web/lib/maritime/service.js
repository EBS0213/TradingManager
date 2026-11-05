import {getSql} from '@/lib/db'
import {normalizeVessel,normalizeFreight,freightRows} from './data.mjs'
let ready
async function database(){
 const sql=await getSql();
 if(!ready)ready=(async()=>{
  await sql`CREATE TABLE IF NOT EXISTS tm_maritime_snapshot (kind TEXT PRIMARY KEY,payload JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS tm_maritime_vessel (mmsi TEXT PRIMARY KEY,payload JSONB NOT NULL,as_of TIMESTAMPTZ NOT NULL,lat DOUBLE PRECISION NOT NULL,lon DOUBLE PRECISION NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS tm_maritime_vessel_time ON tm_maritime_vessel(as_of)`;
  await sql`INSERT INTO tm_maritime_vessel SELECT item->>'mmsi',item,(item->>'asOf')::timestamptz,(item->>'lat')::float8,(item->>'lon')::float8 FROM tm_maritime_snapshot s CROSS JOIN LATERAL jsonb_array_elements(s.payload->'items') item WHERE s.kind='vessels' ON CONFLICT(mmsi) DO NOTHING`;
 })().catch(e=>{ready=null;throw e});await ready;return sql
}
export async function storeSnapshot(body){
 if(!['vessels','freight'].includes(body?.kind)||!Array.isArray(body.items))throw Error('자료 형식 오류')
 if(body.items.length>(body.kind==='vessels'?5000:10))throw Error('자료 개수 초과')
 const items=body.items.map(x=>body.kind==='vessels'?normalizeVessel(x):normalizeFreight(x))
 if(items.some(x=>!x))throw Error('선박 위치·식별자·관측시각 오류')
 if(new Set(items.map(x=>x.mmsi||x.code)).size!==items.length)throw Error('중복 식별자')
 let source
 if(body.kind==='vessels'){
  const url=new URL(body.source?.url||'')
  if(url.protocol!=='https:'||url.username||url.password||!body.source?.name)throw Error('AIS 출처 필요')
  source={name:String(body.source.name).slice(0,100),url:url.href}
 }
 const sql=await database()
 if(body.kind==='vessels'){
  await sql`INSERT INTO tm_maritime_vessel SELECT item->>'mmsi',item,(item->>'asOf')::timestamptz,(item->>'lat')::float8,(item->>'lon')::float8 FROM jsonb_array_elements(${JSON.stringify(items)}::jsonb) item ON CONFLICT(mmsi) DO UPDATE SET payload=excluded.payload,as_of=excluded.as_of,lat=excluded.lat,lon=excluded.lon WHERE excluded.as_of>=tm_maritime_vessel.as_of`;
  await sql`DELETE FROM tm_maritime_vessel WHERE as_of < now()-interval '7 days'`;
 }
 const payload={items:body.kind==='vessels'?[]:items,...(source?{source}:{})};
 await sql`INSERT INTO tm_maritime_snapshot(kind,payload) VALUES(${body.kind},${JSON.stringify(payload)}::jsonb) ON CONFLICT(kind) DO UPDATE SET payload=excluded.payload,updated_at=now()`
 return items.length
}
let cache,pending
export async function maritimeSnapshot(){
 if(cache&&Date.now()-cache.at<60000)return cache.value
 if(pending)return pending
 pending=(async()=>{
  let stored=[],storageError=false
  try{const sql=await database();stored=await sql`SELECT kind,payload,updated_at FROM tm_maritime_snapshot`}catch(error){storageError=true;console.error('maritime_storage', {name:error?.name,code:error?.code||'unknown',detail:error instanceof TypeError?String(error.message).replace(/https?:\/\/\S+|postgres(?:ql)?:\/\/\S+/g,'[redacted]').slice(0,300):undefined})}
  const ships=stored.find(x=>x.kind==='vessels'),freight=stored.find(x=>x.kind==='freight')
  let vessels=(ships?.payload?.items||[]).map(x=>normalizeVessel(x)).filter(Boolean),source=ships?.payload?.source||{name:'MarineTraffic / Kpler AIS',url:'https://servicedocs.marinetraffic.com/'},status=ships?'observed':'key_required',note=ships?'실제 수신 위치 기준 · 지역별 수신 범위 차이 있음'+(vessels.length>=5000?' · 최근 수신 최대 5,000척 표시':''):''
  if(process.env.MARINETRAFFIC_API_KEY){
   try{
    const url='https://services.marinetraffic.com/api/exportvessels-custom-area/'+encodeURIComponent(process.env.MARINETRAFFIC_API_KEY)+'?v=2&protocol=jsono&timespan=60&limit=1000'
    const response=await fetch(url,{signal:AbortSignal.timeout(12000),cache:'no-store'})
    if(!response.ok)throw Error('AIS 응답 실패')
    const raw=await response.json();if(!Array.isArray(raw.DATA))throw Error('AIS 형식 오류')
    vessels=raw.DATA.map(x=>normalizeVessel(x)).filter(Boolean);status=vessels.some(x=>!x.stale)?'observed':vessels.length?'stale':'empty';source={name:'MarineTraffic / Kpler AIS',url:'https://servicedocs.marinetraffic.com/'}
    note=raw.METADATA?.CURSOR?'구독 영역의 최근 관측 중 첫 1,000건 표시':'구독 영역의 최근 AIS 관측'
   }catch{status=vessels.length?'stale':'unavailable';note='AIS 연결 실패'}
  }else if(vessels.length&&vessels.every(x=>x.stale))status='stale'
  if(storageError&&!vessels.length&&status==='key_required')status='unavailable'
  const value={ok:true,vessels,status,note,source,updatedAt:ships?.updated_at||null,freight:freightRows(freight?.payload?.items||[]),sources:[{...source,status},{name:'Freight index feed',url:'https://www.balticexchange.com/',status:freight?'observed':'key_required'}]}
  cache={at:Date.now(),value};return value
 })().finally(()=>{pending=null})
 return pending
}
export function invalidateMaritime(){cache=null}

export async function queryFleet(query){
 const sql=await database();
 const bounds=(query.get('bounds')||'').split(',').map(Number);
 const valid=bounds.length===4&&bounds.every(Number.isFinite)&&bounds[0]>=-90&&bounds[2]<=90&&bounds[0]<bounds[2]&&bounds[1]>=-180&&bounds[1]<=180&&bounds[3]>=-180&&bounds[3]<=180;
 const q=(query.get('q')||'').trim().toLowerCase().slice(0,100),category=query.get('category')||'all',motion=query.get('motion')||'all';
 const south=valid&&!q?bounds[0]:-90,north=valid&&!q?bounds[2]:90,west=valid&&!q?bounds[1]:-180,east=valid&&!q?bounds[3]:180;
 const hours=query.get('hours')==='168'?168:24;
 const after=/^\d{9}$/.test(query.get('after')||'')?query.get('after'):'';
 const result=await sql`WITH matched AS (SELECT * FROM tm_maritime_vessel WHERE as_of>now()-(${hours}::int*interval '1 hour') AND lat BETWEEN ${south} AND ${north} AND (CASE WHEN ${west}::float8<=${east}::float8 THEN lon BETWEEN ${west} AND ${east} ELSE lon>=${west} OR lon<=${east} END) AND (${q}='' OR position(${q} in lower(coalesce(payload->>'name','')||' '||mmsi||' '||coalesce(payload->>'imo','')))>0) AND (${category}='all' OR payload->>'category'=${category}) AND (${motion}='all' OR (${motion}='moving' AND (payload->>'speed')::float8>1) OR (${motion}='slow' AND (payload->>'speed')::float8<=1) OR (${motion}='unknown' AND payload->>'speed' IS NULL))), stats AS (SELECT count(*)::int AS count,count(*) FILTER(WHERE (payload->>'speed')::float8>1)::int AS moving FROM matched), limited AS (SELECT CASE WHEN ${q}='' THEN payload-'track' ELSE payload END AS payload FROM matched WHERE mmsi>${after} ORDER BY mmsi LIMIT 5000) SELECT stats.*,(SELECT coalesce(jsonb_agg(payload ORDER BY payload->>'mmsi'),'[]'::jsonb) FROM limited) AS vessels FROM stats`;

 const totals=await sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE (payload->>'speed')::float8>1)::int AS moving FROM tm_maritime_vessel WHERE as_of>now()-(${hours}::int*interval '1 hour')`;
 const resultRow=result[0];
 return {vessels:resultRow.vessels.map(r=>normalizeVessel(r)).filter(Boolean),clusters:[],nextCursor:resultRow.vessels.length===5000?resultRow.vessels.at(-1).mmsi:null,visibleCount:resultRow.count,visibleMoving:resultRow.moving,total:totals[0]?.total||0,totalMoving:totals[0]?.moving||0,truncated:false};
}

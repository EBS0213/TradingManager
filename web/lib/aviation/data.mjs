const num=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))?Number(v):null;
const text=v=>String(v||'').trim().slice(0,100);
export function normalizeAircraft(raw,providerTime,now=Date.now()){
 const lat=num(raw.lat),lon=num(raw.lon),age=num(raw.seen_pos),stamp=num(providerTime);
 if(lat===null||lon===null||Math.abs(lat)>90||Math.abs(lon)>180||age===null||age<0||age>300||stamp===null)return null;
 const observed=stamp-age*1000;if(observed>now+300000||observed<now-600000)return null;
 const id=text(raw.hex).toLowerCase();if(!/^~?[a-f0-9]{6}$/.test(id))return null;
 const ground=raw.alt_baro==='ground',altitude=ground?0:num(raw.alt_baro),speed=num(raw.gs),heading=num(raw.track);
 return {id,callsign:text(raw.flight).replace(/@+$/,'').trim()||text(raw.r)||id.toUpperCase(),registration:text(raw.r),aircraft:text(raw.t),lat,lon,asOf:new Date(observed).toISOString(),ground,altitude,speed:speed!==null&&speed>=0?speed:null,heading:heading!==null&&heading>=0&&heading<360?heading:null,verticalRate:num(raw.baro_rate),squawk:text(raw.squawk),category:text(raw.category),source:text(raw.type),stale:now-observed>60000};
}
export function area(query){
 const lat=num(query.get('lat')??35.54),lon=num(query.get('lon')??129.32);
 if(lat===null||lon===null||Math.abs(lat)>85||Math.abs(lon)>180)throw Error('Invalid map center');
 return {lat:Math.round(lat*10)/10,lon:Math.round(lon*10)/10,radius:250,...(query.get("wide")==="1"?{wide:true}:{})};
}
export async function aircraftSnapshot(location,{fetcher=fetch,now=Date.now}={}){
 const response=await fetcher(`https://api.adsb.lol/v2/point/${location.lat}/${location.lon}/${location.radius}`,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json','User-Agent':'TM26-Aviation/1.0'},next:{revalidate:30}});
 if(!response.ok)throw Error('provider_http_'+response.status);
 const raw=await response.json();if(!Array.isArray(raw.ac))throw Error('provider_format');
 const aircraft=raw.ac.map(x=>normalizeAircraft(x,raw.now,now())).filter(Boolean);
 return {ok:true,status:aircraft.length?'observed':'empty',aircraft,area:location,updatedAt:new Date(now()).toISOString(),source:{name:'adsb.lol',url:'https://www.adsb.lol/docs/open-data/api/',license:'ODbL-1.0'},total:aircraft.length};
}

// Nine overlapping receiver areas extend regional coverage without inventing positions.
export async function regionalSnapshot(location,options={}){
 if(!location.wide)return aircraftSnapshot(location,options);
 const step=5,lonStep=step/Math.max(.25,Math.cos(location.lat*Math.PI/180));
 const areas=[];for(const y of [-1,0,1])for(const x of [-1,0,1])areas.push({lat:Math.max(-85,Math.min(85,location.lat+y*step)),lon:((location.lon+x*lonStep+540)%360)-180,radius:250});
 const results=new Array(areas.length);let cursor=0;await Promise.all(Array.from({length:3},async()=>{while(cursor<areas.length){const i=cursor++;try{results[i]={status:'fulfilled',value:await aircraftSnapshot(areas[i],options)}}catch(reason){results[i]={status:'rejected',reason}}}}));
 const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!good.length)throw Error('provider_unavailable');
 const unique=new Map();for(const r of good)for(const a of r.aircraft){const old=unique.get(a.id);if(!old||a.asOf>old.asOf)unique.set(a.id,a)}
 const aircraft=[...unique.values()];return {...good[0],aircraft,total:aircraft.length,area:location,coverage:results.flatMap((r,i)=>r.status==='fulfilled'?[areas[i]]:[]),status:good.length<areas.length?'partial':aircraft.length?'observed':'empty'};
}

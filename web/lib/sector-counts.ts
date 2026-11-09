type Row=Record<string,unknown>;
export type SectorCountPoint={stamp:string;cnt:Record<string,number>;basis?:string};
const colorFor=(i:number)=>{const h=(i*137.508)%360,a=.72*.37;const channel=(n:number)=>{const k=(n+h/30)%12;return Math.round(255*(.63-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');};return '#'+channel(0)+channel(8)+channel(4);};
const day=(s:string)=>Date.parse(s.slice(0,10)+'T00:00:00Z');
export function sectorCountSeries(rows:Row[],stamp:string,history:SectorCountPoint[]=[]){
 const names=new Set<string>(),cnt:Record<string,number>={};
 for(const row of rows){const name=String(row['업종']||'-').trim()||'-';names.add(name);if(row['판정']==='통과'&&!row['제외사유']&&!row['부적합사유'])cnt[name]=(cnt[name]||0)+1;}
 const current={stamp,cnt,basis:'main'},byDay=new Map<string,SectorCountPoint>();
 const end=day(stamp),start=end-29*86400000;
 for(const p of [...history,current].sort((a,b)=>String(a?.stamp).localeCompare(String(b?.stamp)))){
  if(!p||p.basis!=='main'||!p.cnt||!Number.isFinite(day(p.stamp))||day(p.stamp)<start||day(p.stamp)>end)continue;
  byDay.set(p.stamp.slice(0,10),p);
 }
 const points=[...byDay.values()];for(const p of points)for(const name of Object.keys(p.cnt))names.add(name);
 const colors=[...names].sort().map((name,i)=>({name,color:colorFor(i),dash:i%3===0?undefined:i%3===1?'7 3':'2 3'}));
 const series=colors.map(s=>({...s,count:cnt[s.name]||0,values:points.map(p=>{const n=p.cnt[s.name];return {stamp:p.stamp,value:n===undefined?0:Number.isFinite(n)&&n>=0?n:null};})})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ko'));
 return {points,series,start,end};
}

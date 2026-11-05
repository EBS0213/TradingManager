type Row=Record<string,unknown>;
export type SectorRs={name:string;rs:number;count:number;passed:number};
export type SectorRsSnapshot=Record<string,SectorRs[]>;
export type SectorRsPoint={stamp:string;rs:SectorRsSnapshot};
const value=(v:unknown)=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
export function sectorRsSnapshot(rows:Row[],market:string):SectorRsSnapshot{
 const groups:SectorRsSnapshot={};
 for(const scope of market==='KR'?['all','KOSPI','KOSDAQ']:['all']){
  const sectors=new Map<string,{scores:number[];passed:number}>();
  for(const row of rows){
   if(scope!=='all'&&row['시장']!==scope)continue;
   const name=String(row['업종']||'').trim(),rs=value(row.RS);
   if(!name||/^(-|기타|기타금융|지주|투자회사)$/.test(name)||rs===null||rs<0||rs>100)continue;
   const group=sectors.get(name)||{scores:[],passed:0};group.scores.push(rs);if(row['판정']==='통과')group.passed++;sectors.set(name,group);
  }
  groups[scope]=[...sectors].filter(([,group])=>group.scores.length>=5).map(([name,group])=>{const scores=group.scores.sort((a,b)=>a-b),mid=scores.length>>1;return {name,rs:scores.length%2?scores[mid]:(scores[mid-1]+scores[mid])/2,count:scores.length,passed:group.passed};}).sort((a,b)=>b.rs-a.rs||a.name.localeCompare(b.name,'ko'));
 }
 return groups;
}
export function rsHistory(points:SectorRsPoint[],current:SectorRsPoint):SectorRsPoint[]{
 const byStamp=new Map<string,SectorRsPoint>();
 for(const point of [...points,current])if(point&&point.rs&&/^\d{4}-\d{2}-\d{2}/.test(point.stamp))byStamp.set(point.stamp,point);
 return [...byStamp.values()].sort((a,b)=>a.stamp.localeCompare(b.stamp)).slice(-200);
}

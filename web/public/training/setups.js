// Pattern candidates, not guaranteed outcomes. Every read stops at the decision date.
// Numerical tolerances below are app screening heuristics, not universal textbook rules.
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const high=(r,a,b)=>Math.max(...r.slice(a,b+1).map(x=>x[2]));
const low=(r,a,b)=>Math.min(...r.slice(a,b+1).map(x=>x[3]));
const peak=(r,a,b)=>{let k=a;for(let j=a+1;j<=b;j++)if(r[j][2]>r[k][2])k=j;return k;};
const trough=(r,a,b)=>{let k=a;for(let j=a+1;j<=b;j++)if(r[j][3]<r[k][3])k=j;return k;};
const sma=(r,i,n)=>mean(r.slice(i-n+1,i+1).map(x=>x[4]));
const depth=(h,l)=>(1-l/h)*100;
const priorAdvance=(r,start)=>(r[start][2]/low(r,Math.max(0,start-90),start-5)-1)*100;

export function confirmedSwings(rows,start,end,width=3){
 const points=[];
 for(let j=start+width;j<=end-width;j++){
  const hi=rows[j][2]>high(rows,j-width,j-1)&&rows[j][2]>=high(rows,j+1,j+width);
  const lo=rows[j][3]<low(rows,j-width,j-1)&&rows[j][3]<=low(rows,j+1,j+width);
  if(hi===lo)continue; // ambiguous outside bars are not independent swing points
  const p={i:j,type:hi?'high':'low',price:rows[j][hi?2:3]},last=points.at(-1);
  if(last?.type===p.type){if(p.type==='high'?p.price>last.price:p.price<last.price)points[points.length-1]=p;}
  else points.push(p);
 }
 return points;
}

export function findSetups(rows,i){
 if(i<240)return {};
 const close=rows[i][4],ma20=sma(rows,i,20),ma50=sma(rows,i,50),ma200=sma(rows,i,200);
 const vol50=mean(rows.slice(i-50,i).map(r=>r[5]));
 const dry=mean(rows.slice(i-4,i+1).map(r=>r[5]))/vol50;
 const tight=(Math.max(...rows.slice(i-4,i+1).map(r=>r[4]))/Math.min(...rows.slice(i-4,i+1).map(r=>r[4]))-1)*100;
 const quietRange=depth(high(rows,i-4,i),low(rows,i-4,i));
 const dayMove=Math.abs((close/rows[i-1][4]-1)*100);
 // Keep the selection near a constructive base, excluding extended runs and breakdown days.
 if(close<ma200||ma50<ma200*.98||ma50<sma(rows,i-20,50)*.98||close<ma50*.97||close>ma20*1.10||dayMove>5)return {};
 const found={};
 const evidence=(kind,start,pivot,extra)=>({kind,start,pivot,end:i,priorAdvance:priorAdvance(rows,start),dry,tight,quietRange,...extra});
 if(tight<=3.5&&quietRange<=6&&dry<=1){
  // Flat base: 5+ weeks, shallow range, previous advance and a quiet right edge.
  for(const length of [30,40,50,65]){
   const start=i-length+1,rim=peak(rows,start,start+Math.floor(length/3)),pivot=high(rows,start,i-1),bottom=low(rows,start,i);
   const baseDepth=depth(pivot,bottom),advance=priorAdvance(rows,rim);
   const drift=Math.abs(mean(rows.slice(i-4,i+1).map(r=>r[4]))/mean(rows.slice(start,start+5).map(r=>r[4]))-1)*100;
   if(advance>=30&&baseDepth>=4&&baseDepth<=15&&drift<=8&&close>=pivot*.96&&close<=pivot*1.01&&rim<=start+10){
    found.flat=evidence('flat',rim,pivot,{baseStart:start,baseLength:length,baseDepth,priorAdvance:advance,quality:20-tight-dry*3+length/20});break;
   }
  }
  // VCP: actual confirmed peak→trough contractions; no equal-width window proxy.
  const swings=confirmedSwings(rows,i-85,i),pairs=[];
  for(let p=0;p<swings.length-1;p++)if(swings[p].type==='high'&&swings[p+1].type==='low'){
   const a=swings[p],b=swings[p+1];pairs.push({high:a.i,low:b.i,peak:a.price,bottom:b.price,depth:depth(a.price,b.price)});
  }
  for(const count of [3,2])for(let end=pairs.length;end>=count;end--){
   if(found.vcp)break;
   const legs=pairs.slice(end-count,end),a=legs[0],c=legs.at(-1);
   if(i-c.low>10||i-c.low<3||i-a.high<20||c.low-a.high>75)continue;
   if(legs.some(l=>l.low-l.high<2||l.low-l.high>20))continue;
   const shrinking=a.depth>=8&&a.depth<=25&&legs.slice(1).every((l,j)=>l.depth<=legs[j].depth*(count===2?.7:.85))&&c.depth>=1.5&&c.depth<=6;
   const structure=legs.slice(1).every((l,j)=>l.bottom>legs[j].bottom&&l.peak<=legs[j].peak*1.04);
   const advance=priorAdvance(rows,a.high);
   if(shrinking&&structure&&advance>=30&&close>=c.peak*.96&&close<=c.peak*1.01){
    found.vcp=evidence('vcp',a.high,c.peak,{legs,priorAdvance:advance,quality:25-c.depth-tight+legs.length});break;
   }
  }
  // Cup-with-handle: both rims, an interior rounded low, and a distinct upper-half handle.
  for(const span of [45,60,80,100,125,150]){
   for(const handleDays of [6,9,12,15]){
    const left=peak(rows,i-span-8,i-span+5),right=peak(rows,i-handleDays-5,i-handleDays);
    if(right-left<35||i-right<5||i-right>20)continue;
    const bottom=trough(rows,left+1,right-1),rim=rows[left][2],cupLow=rows[bottom][3],rightHigh=rows[right][2];
    const cupDepth=depth(rim,cupLow),advance=priorAdvance(rows,left);
    if(cupDepth<15||cupDepth>35||advance<30||bottom-left<10||right-bottom<10||rightHigh<rim*.92||rightHigh>rim*1.05)continue;
    const floor=cupLow+(rim-cupLow)*.25,bottomBars=[];
    for(let j=left+1;j<right;j++)if(rows[j][4]<=floor)bottomBars.push(j);
    if(bottomBars.length<5||bottomBars.at(-1)-bottomBars[0]<6)continue;
    const handleLow=trough(rows,right+1,i),handleDepth=depth(rightHigh,rows[handleLow][3]);
    if(handleLow-right<2||i-handleLow<1||handleDepth<1.5||handleDepth>8||rows[handleLow][3]<(rim+cupLow)/2)continue;
    if(high(rows,right+1,i)>rightHigh*1.01||close<rightHigh*.96||close>rightHigh*1.01||close<ma20*.98)continue;
    const candidate=evidence('cup',left,rightHigh,{left,right,bottom,handleLow,cupDepth,handleDepth,cupLength:right-left+1,handleLength:i-right+1,priorAdvance:advance,quality:30-handleDepth-tight});
    if(!found.cup||candidate.quality>found.cup.quality)found.cup=candidate;
   }
  }
 }
 // Pullback support: an established advance, a low-volume correction, then an early bounce.
 const top=peak(rows,i-22,i-5),bottom=trough(rows,top+1,i-1),drawdown=depth(rows[top][2],rows[bottom][3]);
 const distance=i-bottom,advance=priorAdvance(rows,top),support20=sma(rows,bottom,20),support50=sma(rows,bottom,50);
 const supportDistance=Math.min(Math.abs(rows[bottom][3]/support20-1),Math.abs(rows[bottom][3]/support50-1))*100;
 const pullVolume=mean(rows.slice(top+1,bottom+1).map(r=>r[5]))/vol50;
 if(advance>=30&&bottom-top>=3&&i-top>=7&&distance>=2&&distance<=6&&drawdown>=4&&drawdown<=15&&supportDistance<=3&&rows[bottom][3]>=support50*.96&&pullVolume<=.95&&tight<=5&&quietRange<=7&&dry<=1.15&&close>rows[i-1][4]&&rows[i-1][4]>=rows[i-2][4]&&close<=rows[top][2]&&close<=ma20*1.07){
  found.pullback=evidence('pullback',top,rows[top][2],{top,bottom,drawdown,supportDistance,pullVolume,priorAdvance:advance,quality:20-supportDistance-tight});
 }
 return found;
}

const PALETTE={'#11151b': ['#ffffff', '#080b08'], '#252c36': ['#e3e8f0', '#1d2b1d'], '#8b96a8': ['#64748b', '#8b908b'], '#566171': ['#94a3b8', '#5d6b5d'], '#9ba6b7': ['#475569', '#a6b2a6'], '#697788': ['#64748b', '#8b908b'], '#657285': ['#64748b', '#8b908b'], '#10151df5': ['#fffffff5', '#080b08f5'], '#d2d7df': ['#475569', '#b5bfb5'], '#40bbaa': ['#c00000', '#e07070'], '#ee6973': ['#1450b4', '#6295d6'], '#329586a0': ['#c0000070', '#e0707070'], '#c85a64a0': ['#1450b470', '#6295d670'], '#75cfff': ['#006d93', '#75cfff'], '#ef9dce': ['#9e397b', '#ef9dce'], '#e6c36b': ['#a77708', '#e6c36b'], '#bb91ef': ['#8457b5', '#bb91ef'], '#5dabe9': ['#236db0', '#5dabe9']};
const themeColor=c=>PALETTE[c]?.[document.documentElement.dataset.theme==='dark'?1:0]??c;
export const chartDate=(date,showYear=false)=>showYear?date:date.slice(5);
const colors=()=>({10:themeColor('#e6c36b'),20:themeColor('#bb91ef'),50:themeColor('#5dabe9'),200:themeColor('#d2d7df')});
export class TerminalChart{
 constructor(canvas,tip){this.canvas=canvas;this.tip=tip;this.ctx=canvas.getContext('2d');this.hover=null;
  window.addEventListener('tm-theme-change',()=>this.draw());
  new ResizeObserver(()=>this.draw()).observe(canvas.parentElement);
  canvas.addEventListener('pointermove',e=>{if(!this.model||!this.geometry)return;const b=canvas.getBoundingClientRect();const {left,dx,start}=this.geometry;const i=Math.round((e.clientX-b.left-left)/dx)+start;this.hover=i>=start&&i<=this.model.reveal?i:null;this.draw();});
  canvas.addEventListener('pointerleave',()=>{this.hover=null;this.draw();});
  canvas.addEventListener('keydown',e=>{if(!this.model||!['ArrowLeft','ArrowRight','Escape'].includes(e.key))return;e.preventDefault();if(e.key==='Escape')this.hover=null;else this.hover=Math.max(this.geometry.start,Math.min(this.model.reveal,(this.hover??this.model.reveal)+(e.key==='ArrowRight'?1:-1)));this.draw();});
 }
 set(model){this.model=model;if(this.hover>model.reveal)this.hover=null;this.draw();}
 draw(){
  if(!this.model)return;const {data,cut,end,reveal,range,enabled,log,pivot,choice,setup,execution,showYear=false}=this.model,rows=data.rows,dateLabel=date=>chartDate(date,showYear);
  const canvas=this.canvas,c=this.ctx,w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;
  if(!w||!h)return;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.fillStyle=themeColor('#11151b');c.fillRect(0,0,w,h);
  const left=14,right=64,top=22,priceBottom=h*.69,volTop=h*.75,volBottom=h-49,start=Math.max(0,cut-range+1),dx=(w-left-right)/(end-start+2),x=i=>left+(i-start)*dx;
  this.geometry={left,dx,start};const shown=rows.slice(start,reveal+1);
  const values=shown.flatMap(r=>[r[2],r[3]]);for(const n of enabled)for(let i=start;i<=reveal;i++)if(data.ma[n][i]!=null)values.push(data.ma[n][i]);
  if(pivot)values.push(pivot);let min=Math.min(...values),max=Math.max(...values);const pad=(max-min)*.09||max*.05;min=Math.max(.00001,min-pad);max+=pad;
  const transform=v=>log?Math.log(v):v,minT=transform(min),maxT=transform(max),y=v=>top+(maxT-transform(v))/(maxT-minT)*(priceBottom-top);
  c.font='10px "IBM Plex Mono",monospace';c.textAlign='left';
  const grid=themeColor('#252c36');for(let k=0;k<=5;k++){const py=top+(priceBottom-top)*k/5,val=log?Math.exp(maxT-(maxT-minT)*k/5):max-(max-min)*k/5;c.strokeStyle=grid;c.lineWidth=.6;c.beginPath();c.moveTo(left,py);c.lineTo(w-right+3,py);c.stroke();c.fillStyle=themeColor('#8b96a8');c.fillText(val.toFixed(val<10?2:1),w-right+10,py+3);}
  let lastMonth='',lastLabelX=-90;for(let i=start;i<=end;i++){
   const day=rows[i][0],month=day.slice(0,7);if(month===lastMonth)continue;lastMonth=month;
   const px=x(i);
   if(i===start){const next=rows.findIndex((r,j)=>j>i&&r[0].slice(0,7)!==month);if(next>=0&&x(next)-px<40)continue;}
   if(px-lastLabelX<32)continue;lastLabelX=px;
   c.strokeStyle=grid;c.beginPath();c.moveTo(px,top);c.lineTo(px,volBottom);c.stroke();c.fillStyle=i>reveal?themeColor('#566171'):themeColor('#9ba6b7');
   c.fillText(`${Number(day.slice(5,7))}월`,px+3,h-27);c.fillStyle=themeColor('#697788');c.font='9px "IBM Plex Mono",monospace';if(showYear)c.fillText(day.slice(0,4),px+3,h-12);c.font='10px "IBM Plex Mono",monospace';
  }
  const boundary=x(cut)+dx*.6;c.fillStyle='#23334525';c.fillRect(boundary,top,w-right-boundary,volBottom-top);
  if(reveal===cut){c.textAlign='center';c.fillStyle=themeColor('#657285');c.font='10px "Noto Sans KR",sans-serif';const cx=(boundary+w-right)/2;c.fillText('아직 열리지 않은 미래',cx,priceBottom*.50);c.font='9px "IBM Plex Mono",monospace';c.fillText('REPLAY',cx,priceBottom*.50+21);}
  c.save();c.beginPath();c.rect(left-3,top-8,w-right-left+6,volBottom-top+9);c.clip();
  for(const n of enabled){c.strokeStyle=colors()[n];c.lineWidth=n===200?1.1:1;c.beginPath();let started=false;for(let i=start;i<=reveal;i++){const value=data.ma[n][i];if(value==null){started=false;continue;}if(!started){c.moveTo(x(i),y(value));started=true;}else c.lineTo(x(i),y(value));}c.stroke();}
  const body=Math.max(1,Math.min(7,dx*.67));for(let i=start;i<=reveal;i++){const r=rows[i],up=r[4]>=r[1];c.strokeStyle=c.fillStyle=up?themeColor('#40bbaa'):themeColor('#ee6973');c.lineWidth=.8;c.beginPath();c.moveTo(x(i),y(r[2]));c.lineTo(x(i),y(r[3]));c.stroke();c.fillRect(x(i)-body/2,Math.min(y(r[1]),y(r[4])),body,Math.max(1,Math.abs(y(r[1])-y(r[4]))));}
  const maxVol=Math.max(...shown.map(r=>r[5]))*1.08,vy=v=>volBottom-v/maxVol*(volBottom-volTop);
  for(let i=start;i<=reveal;i++){const r=rows[i];c.fillStyle=r[4]>=r[1]?themeColor('#329586a0'):themeColor('#c85a64a0');c.fillRect(x(i)-body/2,vy(r[5]),body,volBottom-vy(r[5]));}
  c.strokeStyle='#dab962';c.lineWidth=.9;c.beginPath();for(let i=start;i<=reveal;i++){if(data.vol[i]==null)continue;if(i===start)c.moveTo(x(i),vy(data.vol[i]));else c.lineTo(x(i),vy(data.vol[i]));}c.stroke();
  if(pivot){c.strokeStyle=themeColor('#e6c36b');c.setLineDash([5,4]);c.beginPath();c.moveTo(x(Math.max(start,setup?.start??cut-18)),y(pivot));c.lineTo(x(reveal),y(pivot));c.stroke();c.setLineDash([]);c.fillStyle=themeColor('#e6c36b');c.textAlign='left';c.font='9px "IBM Plex Mono",monospace';c.fillText(`PIVOT ${pivot.toFixed(2)}`,x(Math.max(start,setup?.start??cut-35)),y(pivot)-7);}
  if(setup&&reveal===end){
   const s=setup,patternEnd=s.end,color=themeColor('#75cfff'),labels=[];c.strokeStyle=color;c.lineWidth=2;c.textAlign='left';c.font='11px "Noto Sans KR",sans-serif';
   const line=(points,col=color)=>{c.strokeStyle=col;c.beginPath();points.forEach(([i,v],j)=>j?c.lineTo(x(i),y(v)):c.moveTo(x(i),y(v)));c.stroke();for(const [i,v] of points){c.fillStyle=col;c.beginPath();c.arc(x(i),y(v),3,0,Math.PI*2);c.fill();}};
   const label=(text,i,v,col=color)=>{const width=c.measureText(text).width+10,px=Math.max(left+4,Math.min(w-right-width,x(i)));let py=Math.max(top+16,Math.min(priceBottom-5,y(v)-12));for(let n=0;n<8&&labels.some(b=>px<b.x+b.w&&px+width>b.x&&Math.abs(py-b.y)<23);n++)py=Math.min(priceBottom-4,py+24);labels.push({x:px,y:py,w:width});c.strokeStyle=col;c.lineWidth=.7;c.beginPath();c.moveTo(x(i),y(v));c.lineTo(px,py);c.stroke();c.fillStyle=themeColor('#10151df5');c.fillRect(px-4,py-13,width,19);c.fillStyle=col;c.fillText(text,px,py);c.lineWidth=2;};
   if(s.kind==='vcp'){const points=[];s.legs.forEach((l,j)=>{points.push([l.high,l.peak],[l.low,l.bottom]);label(`수축 ${j+1}: −${l.depth.toFixed(1)}%`,l.low,l.bottom);});points.push([patternEnd,rows[patternEnd][4]]);line(points);}
   if(s.kind==='cup'){line([[s.left,rows[s.left][2]],[s.bottom,rows[s.bottom][3]],[s.right,rows[s.right][2]]]);label(`컵 깊이 ${s.cupDepth.toFixed(1)}%`,s.bottom,rows[s.bottom][3]);line([[s.right,rows[s.right][2]],[s.handleLow,rows[s.handleLow][3]],[patternEnd,rows[patternEnd][4]]],themeColor('#ef9dce'));label(`핸들 ${s.handleDepth.toFixed(1)}%`,s.handleLow,rows[s.handleLow][3],themeColor('#ef9dce'));}
   if(s.kind==='flat'){const low=Math.min(...rows.slice(s.baseStart,patternEnd+1).map(r=>r[3]));c.fillStyle='#75cfff15';c.fillRect(x(s.baseStart),y(s.pivot),x(patternEnd)-x(s.baseStart),y(low)-y(s.pivot));c.strokeStyle=color;c.strokeRect(x(s.baseStart),y(s.pivot),x(patternEnd)-x(s.baseStart),y(low)-y(s.pivot));label(`플랫 베이스 · 깊이 ${s.baseDepth.toFixed(1)}%`,s.baseStart,low);}
   if(s.kind==='pullback'){line([[s.top,rows[s.top][2]],[s.bottom,rows[s.bottom][3]],[patternEnd,rows[patternEnd][4]]]);label(`조정 ${s.drawdown.toFixed(1)}% → 초기 반등`,s.bottom,rows[s.bottom][3]);}
  }
  for(const fill of execution?.fills??[]){
   if(fill.exitIndex>reveal)continue;
   const sx=x(fill.exitIndex),sy=y(fill.exit),color='#f4c66f';
   c.strokeStyle=color;c.lineWidth=1.4;c.setLineDash([3,3]);c.beginPath();c.moveTo(sx,sy);c.lineTo(x(Math.min(reveal,fill.exitIndex+12)),sy);c.stroke();c.setLineDash([]);
   c.fillStyle='#171b20';c.strokeStyle=color;c.lineWidth=2;c.beginPath();c.moveTo(sx,sy-6);c.lineTo(sx+6,sy);c.lineTo(sx,sy+6);c.lineTo(sx-6,sy);c.closePath();c.fill();c.stroke();
   c.font='bold 11px "Noto Sans KR",sans-serif';c.textAlign='left';const text=`${fill.reason==='잔량 직접 매도'?'잔량 매도':'스탑 체결'} ${(fill.fraction*100).toFixed(0)}% · $${fill.exit.toFixed(2)}`,bw=c.measureText(text).width+18,bx=Math.max(left,Math.min(w-right-bw,sx+12)),by=sy>top+65?sy-52:sy+15;
   c.strokeStyle=color;c.lineWidth=1;c.beginPath();c.moveTo(sx,sy);c.lineTo(bx,by+18);c.stroke();c.fillStyle='#28251bf5';c.fillRect(bx,by,bw,37);c.strokeRect(bx,by,bw,37);c.fillStyle=color;c.fillText(text,bx+9,by+15);c.font='10px "IBM Plex Mono",monospace';c.fillText(dateLabel(fill.exitDate),bx+9,by+29);
  }
  c.restore();
  c.strokeStyle='#414e5e';c.lineWidth=.8;c.beginPath();c.moveTo(left,volTop-13);c.lineTo(w-right,volTop-13);c.stroke();c.fillStyle='#7c8a9c';c.textAlign='left';c.font='9px "IBM Plex Mono",monospace';c.fillText('VOLUME · SMA 50',left+2,volTop-20);c.fillText((maxVol/1e6).toFixed(1)+'M',w-right+8,volTop+5);
  c.strokeStyle='#a7b8ca';c.setLineDash([3,4]);c.beginPath();c.moveTo(boundary,top);c.lineTo(boundary,volBottom);c.stroke();c.setLineDash([]);
  c.fillStyle='#aab9ca';c.font='9px "Noto Sans KR",sans-serif';c.textAlign='right';c.fillText(choice?`${choice==='sell'?'PASS':choice.toUpperCase()} 결정`:'판단 시점',boundary-7,top-8);
  const latest=rows[reveal],lastY=y(latest[4]);c.strokeStyle='#507f7880';c.setLineDash([2,4]);c.beginPath();c.moveTo(x(reveal),lastY);c.lineTo(w-right+4,lastY);c.stroke();c.setLineDash([]);c.fillStyle=latest[4]>=latest[1]?'#26766b':'#ae4e58';c.fillRect(w-right+2,lastY-9,right-5,18);c.fillStyle='#f0f4f6';c.font='10px "IBM Plex Mono",monospace';c.textAlign='left';c.fillText(latest[4].toFixed(2),w-right+7,lastY+4);
  this.tip.hidden=this.hover===null;if(this.hover!==null){const i=this.hover,r=rows[i];c.strokeStyle='#77879a';c.setLineDash([2,3]);c.beginPath();c.moveTo(x(i),top);c.lineTo(x(i),volBottom);c.stroke();c.setLineDash([]);this.tip.innerHTML=`<b>${dateLabel(r[0])}</b><br>O ${r[1].toFixed(2)} &nbsp; H ${r[2].toFixed(2)}<br>L ${r[3].toFixed(2)} &nbsp; C ${r[4].toFixed(2)}<br>VOL ${r[5].toLocaleString()}<br>${[...enabled].map(n=>`MA${n} ${data.ma[n][i]?.toFixed(2)??'—'}`).join(' · ')}`;}
  canvas.setAttribute('aria-description',`${dateLabel(rows[start][0])}부터 ${dateLabel(rows[reveal][0])}까지 공개된 일봉. 마지막 종가 ${latest[4].toFixed(2)} 달러. 이동평균 ${[...enabled].join(', ')}일. 거래량과 50일 거래량 평균.${(execution?.fills??[]).map(f=>` ${f.reason==='잔량 직접 매도'?'잔량 매도':'스탑 체결'}: ${dateLabel(f.exitDate)}, ${f.exit.toFixed(2)} 달러, ${(f.fraction*100).toFixed(0)}%.`).join('')}`);
 }
}

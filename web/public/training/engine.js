import {findSetups} from './setups.js';
export const MA = [10,20,50,200];
export const mean = xs => xs.reduce((a,b)=>a+b,0)/xs.length;
export const pct = (a,b)=>(a/b-1)*100;
export function averages(rows,period,column=4){
  let sum=0;return rows.map((r,i)=>{sum+=r[column];if(i>=period)sum-=rows[i-period][column];return i>=period-1?sum/period:null;});
}
export function prepare(rows){return {rows,ma:Object.fromEntries(MA.map(n=>[n,averages(rows,n)])),vol:averages(rows,50,5)};}
export function addMonths(day,months){
  const [y,m,d]=day.split('-').map(Number);const last=new Date(Date.UTC(y,m-1+months+1,0)).getUTCDate();
  return new Date(Date.UTC(y,m-1+months,Math.min(d,last))).toISOString().slice(0,10);
}
export function endIndex(rows,cut,months=3){const limit=addMonths(rows[cut][0],months);let i=cut;while(i+1<rows.length&&rows[i+1][0]<=limit)i++;return i;}
export function features(rows,i){
  if(i<220)throw Error('At least 220 prior sessions required');
  const at=(n,k=i)=>mean(rows.slice(k-n+1,k+1).map(r=>r[4]));
  const r=rows[i],prev=rows[i-1],recent=rows.slice(i-10,i),base=rows.slice(i-60,i);
  const pivot=Math.max(...recent.map(r=>r[2]));
  const vol50=mean(rows.slice(i-50,i).map(r=>r[5]));
  const tight=pct(Math.max(...rows.slice(i-4,i+1).map(r=>r[4])),Math.min(...rows.slice(i-4,i+1).map(r=>r[4])));
  const dry=mean(rows.slice(i-4,i+1).map(r=>r[5]))/vol50;
  const ma20=at(20),ma50=at(50),ma200=at(200);
  const priorHigh=Math.max(...rows.slice(i-20,i-4).map(r=>r[2]));
  const pullLow=Math.min(...rows.slice(i-4,i).map(r=>r[3]));
  const pullVolume=mean(rows.slice(i-4,i).map(r=>r[5]))/vol50;
  const ranges=[rows.slice(i-45,i-30),rows.slice(i-30,i-15),rows.slice(i-15,i)].map(a=>pct(Math.max(...a.map(r=>r[2])),Math.min(...a.map(r=>r[3]))));
  return {close:r[4],pivot,pivotDistance:pct(r[4],pivot),volRatio:r[5]/vol50,dry,tight,ma20,ma50,ma200,
    trend:r[4]>ma50&&ma50>ma200&&ma200>at(200,i-20),
    breakout:r[4]>pivot&&prev[4]<=pivot&&r[5]/vol50>=1.4,
    tightSetup:tight<3.5&&dry<.85&&r[4]>ma50,
    tennis:r[4]>priorHigh&&pct(priorHigh,pullLow)>3&&pct(priorHigh,pullLow)<14&&pullVolume<1&&r[5]/vol50>1.15,
    weakness:r[4]<ma50&&prev[4]>=at(50,i-1)&&r[5]/vol50>1.25,
    extended:pct(r[4],ma20)>15,
    contraction:ranges[0]>ranges[1]&&ranges[1]>ranges[2],ranges,
    baseDepth:pct(Math.max(...base.map(r=>r[2])),Math.min(...base.map(r=>r[3]))),
    dayChange:pct(r[4],prev[4]),pullVolume};
}
export function scoreRound(rows,cut,end,choice){
  if(!['buy','sell'].includes(choice)||end<=cut)throw Error('Invalid round');
  const entry=rows[cut][4],exit=rows[end][4],market=pct(exit,entry);
  const edge=choice==='buy'?market:-market;
  const correct=edge>1e-8;
  const score=correct?2:0;
  const future=rows.slice(cut+1,end+1);
  return {entry,exit,market,edge,score,correct,flat:Math.abs(market)<=1e-8,portfolio:choice==='buy'?market:0,
    worst:pct(Math.min(...future.map(r=>r[3])),entry),best:pct(Math.max(...future.map(r=>r[2])),entry),
    entryDate:rows[cut][0],endDate:rows[end][0],sessions:end-cut};
}
export const THEORY={
  flat:{name:'플랫베이스',pages:'21·25·29·34',text:'사전 상승 뒤 얕은 조정에서 옆으로 쉬는 구조를 봅니다. 오른쪽 끝의 좁은 움직임과 거래량 감소가 공급 소화를 시사합니다. 박스 상단을 넘기 전에는 돌파가 확정된 것이 아닙니다.'},
  cup:{name:'컵앤핸들',pages:'21·25·26·34',text:'컵의 하락과 바닥 형성, 오른쪽 회복 이후 상단에서 짧은 핸들이 만들어지는지를 봅니다. 좁은 V자 반등과 깊거나 아래쪽에 놓인 핸들은 구분합니다. 피벗은 핸들의 고점입니다.'},
  vcp:{name:'VCP · 수축 말단',pages:'22·24·34',text:'실제 스윙 고점에서 저점까지의 조정 폭이 2~3회 줄고, 저점이 높아지며 마지막 구간이 타이트해지는지를 봅니다. 이번 출제는 판단일까지 확인된 고점·저점의 수축을 사용합니다.'},
  pullback:{name:'조정 후 지지·초기 반등',pages:'21·47·48',text:'상승 이후 저거래량 조정, 20일·50일선 부근의 지지와 초기 회복을 함께 봅니다. 아직 신고가를 회복하지 않았다면 테니스볼 액션의 완성으로 부르지 않습니다. 이후 거래량을 동반한 회복이 이어지는지 확인합니다.'},
  breakout:{name:'브레이크아웃',pages:'34·37·45',text:'마지막 수축 구간의 저항을 거래량과 함께 넘어서는지 확인합니다. 돌파했다는 사실만으로 충분하지 않습니다. 피벗에서 얼마나 멀어졌는지와 손절 거리를 함께 봅니다.'},
  tight:{name:'타이트 피벗 · 거래량 마름',pages:'24·34',text:'좁아진 가격 범위와 줄어드는 거래량은 공급 감소의 단서입니다. 타이트한 종가와 피벗 돌파는 서로 다른 단계이며, 주봉의 3주 타이트를 일봉 3개로 해석하면 안 됩니다.'},
  tennis:{name:'테니스볼 액션',pages:'47',text:'돌파 뒤 짧은 눌림에서 거래량이 줄고, 다시 거래량과 함께 고점을 회복하는 반응을 봅니다. 단순히 하루 반등했다고 테니스공으로 확정하지 않습니다. 바닥에 머무는 계란과 회복 속도를 비교합니다.'},
  weakness:{name:'돌파 실패 · 이평선 이탈',pages:'48·53',text:'평균보다 많은 거래량을 동반한 하락과 주요 이동평균선 이탈은 수요 약화의 단서입니다. 약한 돌파 후 강한 매도, 저점 하락, 회복 실패가 겹치는지를 봅니다.'},
  extended:{name:'이격 · 추격 매수 위험',pages:'37·50·53',text:'좋은 종목도 피벗이나 이동평균에서 너무 멀어지면 손절 거리가 길어집니다. 이후 주가가 올랐더라도 당시 진입의 위험이 작았다는 뜻은 아닙니다.'},
  contraction:{name:'VCP · 변동성 수축',pages:'22·24',text:'조정이 반복될수록 낙폭이 줄어드는지를 봅니다. 마지막 수축과 거래량 마름이 중요합니다. 고정 기간의 범위 축소는 후보를 찾는 보조 지표이며 실제 스윙을 읽는 VCP 판정을 대체하지 않습니다.'}
};
export function explain(rows,cut,kind,result){
  const f=features(rows,cut),s=findSetups(rows,cut)[kind],num=n=>n.toFixed(1),p=n=>`${n>=0?'+':''}${num(n)}%`;
  if(s){f.pivot=s.pivot;f.pivotDistance=pct(f.close,s.pivot);}
  const observations=[
    {label:'추세',value:f.trend?'상승 정렬':'혼합 / 약세 정렬',text:`종가는 50일선 ${f.close>f.ma50?'위':'아래'}, 50일선은 200일선 ${f.ma50>f.ma200?'위':'아래'}입니다. 8개 트렌드 템플릿 전체나 RS 순위까지 확인한 판정은 아닙니다.`},
    {label:'거래량',value:`${f.volRatio.toFixed(2)}배`,text:`판단일 거래량 ÷ 직전 50거래일 평균. 최근 5일 평균은 ${f.dry.toFixed(2)}배입니다. 거래량 기준은 종목과 셋업에 따라 달라집니다.`},
    {label:'타이트함',value:`${num(f.tight)}%`,text:'최근 5거래일 종가의 최고·최저 범위입니다. 일봉의 좁은 움직임을 관찰하는 지표이며, 주봉 타이트 확정 기준은 아닙니다.'},
    {label:'피벗 후보',value:`$${f.pivot.toFixed(2)}`,text:`${kind==='flat'?'횡보 박스 상단':kind==='cup'?'핸들 시작 고점':kind==='vcp'?'마지막 수축의 고점':kind==='pullback'?'조정 전 고점':'직전 10일 고점'}을 보조 저항으로 표시했습니다. 종가와의 거리는 ${p(f.pivotDistance)}입니다. 실제 마지막 수축 고점인지 차트에서 확인해야 합니다.`}
  ];
  let diagnosis;
  if(kind==='flat'&&s)diagnosis=`사전 상승 ${num(s.priorAdvance)}% 이후 ${s.baseLength}거래일 동안 깊이 ${num(s.baseDepth)}%의 얕은 박스를 만들었습니다. 최근 5일 종가 폭 ${num(s.tight)}%, 거래량 ${s.dry.toFixed(2)}배로 오른쪽 끝이 조용해진 자리입니다. 상단 돌파와 거래량 유입은 아직 확인할 과제입니다.`;
  else if(kind==='vcp'&&s)diagnosis=`스윙 고점·저점에서 측정한 조정 폭이 ${s.legs.map(l=>num(l.depth)+'%').join(' → ')}로 줄었고, 각 저점이 높아졌습니다. 마지막 수축의 고점 $${s.pivot.toFixed(2)} 부근에서 최근 거래량이 ${s.dry.toFixed(2)}배로 줄어든 후보입니다. 이 자리에서 돌파에 성공할지 실패할지는 아직 알 수 없습니다.`;
  else if(kind==='cup'&&s)diagnosis=`${s.cupLength}거래일 동안 깊이 ${num(s.cupDepth)}%의 컵이 형성되고, 오른쪽 회복 뒤 상단 절반에서 ${s.handleLength}거래일·깊이 ${num(s.handleDepth)}%의 핸들이 나타났습니다. 마지막 5일 종가 범위는 ${num(s.tight)}%입니다. 핸들 고점 $${s.pivot.toFixed(2)}의 돌파와 거래량을 확인할 자리입니다.`;
  else if(kind==='pullback'&&s)diagnosis=`사전 상승 ${num(s.priorAdvance)}% 이후 ${num(s.drawdown)}% 조정이 나왔고, 조정 거래량은 평균의 ${s.pullVolume.toFixed(2)}배였습니다. 저점은 주요 이평선에서 ${num(s.supportDistance)}% 거리였으며 최근 두 종가가 상승했습니다. 초기 지지·반등 후보이지 테니스볼 액션이 완성된 상태는 아닙니다.`;
  else if(kind==='tennis')diagnosis=`직전 눌림의 평균 거래량은 50일 평균의 ${f.pullVolume.toFixed(2)}배였고, 판단일 종가는 앞선 고점을 회복했습니다. 눌림 후 수요가 돌아오는 테니스볼 액션 후보입니다. 앞선 돌파의 질과 손절선 유지 여부를 추가로 확인해야 합니다.`;
  else if(kind==='breakout')diagnosis=`직전 10일 저항 후보를 ${p(f.pivotDistance)} 넘어섰고 거래량은 ${f.volRatio.toFixed(2)}배입니다. 거래량을 동반한 돌파 후보지만, 유효한 베이스와 시장 환경까지 자동 확인된 것은 아닙니다.`;
  else if(kind==='tight')diagnosis=`5일 종가 범위 ${num(f.tight)}%, 거래량 ${f.dry.toFixed(2)}배로 움직임이 좁아졌습니다. 공급 감소를 시사하는 타이트 구간 후보입니다. 아직 저항을 넘지 않았다면 준비 단계와 돌파 확인을 구분해야 합니다.`;
  else if(kind==='weakness')diagnosis=`종가가 50일선 아래로 내려오면서 거래량이 ${f.volRatio.toFixed(2)}배로 늘었습니다. 단순한 저거래량 눌림보다 주의가 필요한 이탈 신호입니다. 이후 반등 여부를 당시부터 알 수는 없습니다.`;
  else if(kind==='extended')diagnosis=`종가가 20일선보다 ${p(pct(f.close,f.ma20))} 높습니다. 추세가 강하더라도 손절선까지의 거리가 긴 추격 구간일 수 있습니다. 상승 결과와 당시 진입의 질은 별개입니다.`;
  else diagnosis=`직전 45일을 15일씩 나눈 가격 범위는 ${f.ranges.map(n=>num(n)+'%').join(' → ')}입니다. 변동성이 줄어드는 후보로, 실제 고점·저점의 수축과 마지막 피벗을 직접 확인해야 합니다.`;
  return {theory:THEORY[kind],observations,diagnosis,
    outcome:`판단일 종가 $${result.entry.toFixed(2)}에서 ${result.horizonMonths??3}개월 종료 종가 $${result.exit.toFixed(2)}까지 ${p(result.market)} 움직였습니다. 경로 중 진입가 대비 최저 ${p(result.worst)}, 최고 ${p(result.best)}였습니다.`,
    related:[kind,...['tight','breakout','tennis','weakness'].filter(k=>k!==kind)].slice(0,4)};
}

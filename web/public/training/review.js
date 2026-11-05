import {features,explain,pct} from './engine.js';
import {findSetups} from './setups.js';
const n=v=>Number.isFinite(v)?v.toFixed(2):'—';
const p=v=>Number.isFinite(v)?`${v>=0?'+':''}${v.toFixed(1)}%`:'—';
// Only decision-date candles inform the setup review; outcome is separate.
export function reviewRound(rows,cut,originalKind,result){
 if(!result||cut<251||!rows[cut])return null;
 const past=rows.slice(0,cut+1),f=features(past,cut),setups=findSetups(past,cut);
 const kind=setups[originalKind]?originalKind:Object.keys(setups)[0];
 const setup=kind?setups[kind]:null;
 const pivot=setup?.pivot??f.pivot,distance=pct(f.close,pivot);
 const average=(period,at=cut)=>past.slice(at-period+1,at+1).reduce((s,r)=>s+r[4],0)/period;
 const ma150=average(150),ma200Before=average(200,cut-21);
 const year=past.slice(-252),high=Math.max(...year.map(r=>r[2])),low=Math.min(...year.map(r=>r[3]));
 const aboveLow=pct(f.close,low),belowHigh=(1-f.close/high)*100;
 const checks=[
  {label:'종가 > 150·200일선',pass:f.close>ma150&&f.close>f.ma200,value:`종가 ${n(f.close)} / 150일 ${n(ma150)} / 200일 ${n(f.ma200)}`},
  {label:'150일선 > 200일선',pass:ma150>f.ma200,value:`${n(ma150)} / ${n(f.ma200)}`},
  {label:'200일선 1개월 상승',pass:f.ma200>ma200Before,value:`${n(ma200Before)} → ${n(f.ma200)}`},
  {label:'50일선 > 150·200일선',pass:f.ma50>ma150&&f.ma50>f.ma200,value:`50일 ${n(f.ma50)}`},
  {label:'종가 > 50일선',pass:f.close>f.ma50,value:`${n(f.close)} / ${n(f.ma50)}`},
  {label:'52주 저점 대비 30% 이상',pass:aboveLow>=30,value:p(aboveLow)},
  {label:'52주 고점에서 25% 이내',pass:belowHigh<=25,value:`고점 대비 ${p(-belowHigh)}`},
 ];
 const trend=checks.every(c=>c.pass),stretch=pct(f.close,f.ma20);
 const diagnosis=kind?explain(past,cut,kind,result).diagnosis:`현재 판단일에는 플랫베이스·VCP·컵앤핸들·지지 반등 후보가 확인되지 않습니다. 최근 5일 종가 폭은 ${n(f.tight)}%, 20일선 이격은 ${p(stretch)}입니다. 최초 출제 이후 WAIT로 날짜가 바뀐 경우에도 현재 위치를 다시 평가합니다.`;
 const entry=distance<0?'저항 아래에서 돌파 대기':distance>5?'피벗 대비 이격 확대':f.volRatio>=1.4?'거래량을 동반한 저항 돌파 후보':'저항 위지만 거래량 확인 필요';
 const ryan=`${entry}. ${setup?'확인된 베이스 피벗':'직전 10일 고점을 사용한 저항 후보'} ${n(pivot)} 대비 종가는 ${p(distance)}이며, 당일 거래량은 직전 50일 평균의 ${n(f.volRatio)}배입니다. ${distance<0?'가격이 저항을 넘기 전에는 타이트한 베이스와 실제 매수 신호를 구분합니다.':distance>5?'추가 상승 여부와 별개로 추격 진입의 손절 거리가 커진 자리입니다.':'돌파 후 저항 위 안착과 거래량 지속을 확인할 자리입니다.'} 최근 5일 평균 거래량은 ${n(f.dry)}배로 ${f.dry<1?'줄었습니다.':'늘었습니다.'}`;
 const stance=!trend?'추세 조건 미충족':!setup?'셋업 재확인':distance<0?'돌파 대기':distance>5?'추격 주의':f.volRatio<1.4?'거래량 확인':'진입 검토 후보';
 const selection=result.choice==='buy'?'BUY':'PASS';
 const risk=result.choice==='buy'?`BUY 결과 ${p(result.selected.returnPct)} · ${result.selected.reason}. ${result.selected.fills?.length?result.selected.fills.map(fill=>`${fill.exitDate} ${fill.reason}, ${n(fill.exit)}에 ${Math.round(fill.fraction*100)}% 청산`).join(' / '):'별도 청산 없이 종료일 평가액을 반영했습니다.'}`:`PASS로 현금을 유지해 수익률은 0%입니다. 동일한 손절·트레일링 설정으로 BUY했다면 ${p(result.buy.returnPct)} (${result.buy.reason})였습니다.`;
 return {date:past[cut][0],title:kind?explain(past,cut,kind,result).theory.name:'셋업 재평가',stance,checks,
  chart:{levels:[{price:pivot,label:setup?'피벗':'저항 후보'}],points:[{date:result.entryDate,price:result.entry,label:result.choice==='buy'?'판단 · BUY':'판단 · PASS'},...(result.selected.fills||[]).map(fill=>({date:fill.exitDate,price:fill.exit,label:fill.reason.startsWith('트레일링')?'트레일링 청산':fill.reason.startsWith('고정')?'손절':'청산'})),{date:result.endDate,price:result.exit,label:'종료'}]},
  sections:[
   {title:'미너비니 · 추세와 수축',text:`가격·이동평균·52주 위치 7개 조건 중 ${checks.filter(c=>c.pass).length}개 충족. ${diagnosis} RS 순위·실적·전체 시장 추세는 이 문제의 일봉 자료만으로 확인할 수 없습니다.`},
   {title:'라이언 · 진입 위치와 거래량',text:ryan},
   {title:'결과와 실행 복기',text:`${result.entryDate} → ${result.endDate} · ${result.horizonMonths??3}개월. 종가 변화 ${p(result.market)}, 기간 중 진입가 대비 최대 상승 ${p(result.best)} / 최대 하락 ${p(result.worst)}. ${risk}`},
   {title:'이번 문제의 핵심',text:`당시 판단은 ‘${stance}’입니다. ${selection}의 게임 방향 판정은 ${result.flat?'보합':result.correct?'정답':'오답'}이지만, 종료 수익률만으로 진입의 질을 판단하지 않습니다. ${!trend?'추세가 약할 때는 반등 기대보다 추세 회복을 먼저 확인합니다.':distance>5?'이미 올라간 가격을 따라가기보다 손절 거리가 짧은 다음 베이스를 기다립니다.':distance<0?'관심 후보를 찾는 단계와 실제 돌파 진입을 구분합니다.':'진입 전 정한 손절을 지키고, 돌파 후 가격·거래량의 반응을 추적합니다.'}`}
  ]};
}

export const DEFAULT_SETTINGS={stopPct:7,trailingPct:null,trailingSellPct:100,sellMode:'cash',capital:10000,horizonMonths:3};
export function validateSettings(s){
 return !!s&&(s.horizonMonths===undefined||[3,6,9,12].includes(s.horizonMonths))&&[s.stopPct,s.trailingPct].every(n=>n===null||(Number.isFinite(n)&&n>=.5&&n<=50))&&(s.trailingSellPct===undefined||(Number.isFinite(s.trailingSellPct)&&s.trailingSellPct>=1&&s.trailingSellPct<=100))&&['short','cash'].includes(s.sellMode)&&Number.isFinite(s.capital)&&s.capital>=100&&s.capital<=1e9;
}
export function simulateTrade(rows,cut,end,side,settings){
 if(!validateSettings(settings)||!['buy','sell'].includes(side)||end<cut||end>=rows.length)throw Error('Invalid trade inputs');
 const entry=rows[cut][4],short=false;
 if(side==='sell')return {side,entry,exit:entry,exitIndex:end,exitDate:rows[end][0],returnPct:0,reason:'PASS · 현금 유지',stopPrice:null,short:false,fills:[],remainingFraction:0,realizedValue:entry,marketValue:0,totalValue:entry};
 let risk=settings,changeIndex=0,peak=entry,remainingFraction=1,realizedValue=0,trailed=false;
 const changes=settings.changes??[],fills=[];
 function fill(j,price,stopPrice,fraction,reason){fills.push({exit:price,exitIndex:j,exitDate:rows[j][0],stopPrice,fraction,reason});realizedValue+=fraction*price;remainingFraction=Math.max(0,remainingFraction-fraction);}
 for(let j=cut+1;j<=end&&remainingFraction>0;j++){
  while(changeIndex<changes.length&&changes[changeIndex].after<j)risk={...risk,...changes[changeIndex++]};
  const fixed=risk.stopPct===null?null:entry*(1+(short?1:-1)*risk.stopPct/100);
  // Prior observed highs only. A BUY trailing fill must itself be above entry.
  const trail=!short&&!trailed&&risk.trailingPct!==null?peak*(1-risk.trailingPct/100):null;
  if(trail!==null&&trail>entry&&rows[j][3]<=trail){
   const gap=rows[j][1]<=trail,price=gap?rows[j][1]:trail;
   if(price>entry){fill(j,price,trail,Math.min(remainingFraction,(risk.trailingSellPct??100)/100),'트레일링 스탑'+(gap?' · 갭 시가 체결':''));trailed=true;}
  }
  // Fixed stops liquidate the remaining position, including after a partial trailing fill.
  if(remainingFraction>0&&fixed!==null){
   const gap=short?rows[j][1]>=fixed:rows[j][1]<=fixed;
   const hit=short?rows[j][2]>=fixed:rows[j][3]<=fixed;
   if(gap||hit)fill(j,gap?rows[j][1]:fixed,fixed,remainingFraction,'고정 손절'+(gap?' · 갭 시가 체결':''));
  }
  if(!short&&remainingFraction>0&&trailed&&settings.remainingAction?.action==='sell'&&settings.remainingAction.after===j)fill(j,rows[j][4],null,remainingFraction,'잔량 직접 매도');
  peak=Math.max(peak,rows[j][2]);
 }
 const marketValue=remainingFraction*rows[end][4],totalValue=realizedValue+marketValue,last=fills.at(-1);
 const exitIndex=remainingFraction>0?end:last.exitIndex;
 return {side,entry,exit:totalValue,exitIndex,exitDate:rows[exitIndex][0],returnPct:(short?(entry-totalValue)/entry:(totalValue-entry)/entry)*100,
  reason:remainingFraction>0?(fills.length?'트레일링 스탑 + 잔여 평가액':'평가액'):last.reason,stopPrice:last?.stopPrice??null,short,fills,remainingFraction,realizedValue,marketValue,totalValue};
}
export function evaluateRound(rows,cut,end,choice,settings){
 const buy=simulateTrade(rows,cut,end,'buy',settings),sell=simulateTrade(rows,cut,end,'sell',settings),selected=choice==='buy'?buy:sell;
 const market=(rows[end][4]/rows[cut][4]-1)*100;
 // Score always evaluates the 3-month direction, independently of stop execution and P&L.
 const correct=(choice==='buy'?market:-market)>1e-8;
 return {buy,sell,selected,choice,horizonMonths:settings.horizonMonths??3,market,flat:Math.abs(market)<=1e-8,correct,score:correct?2:0,entry:rows[cut][4],exit:rows[end][4],entryDate:rows[cut][0],endDate:rows[end][0],sessions:end-cut,
  worst:(Math.min(...rows.slice(cut+1,end+1).map(r=>r[3]))/rows[cut][4]-1)*100,
  best:(Math.max(...rows.slice(cut+1,end+1).map(r=>r[2]))/rows[cut][4]-1)*100};
}
export function portfolio(records,settings,count=10){
 const trades=Object.values(records),allocation=settings.capital/count;
 const totalPct=trades.reduce((sum,r)=>sum+r.selected.returnPct,0),profit=allocation*totalPct/100;
 return {allocation,profit,balance:settings.capital+profit,returnPct:totalPct/count,sumPct:totalPct,completed:trades.length};
}

export function winStats(records){const trades=Object.values(records).filter(r=>r.choice==='buy'),wins=trades.filter(r=>r.selected.returnPct>1e-8).length;return {wins,trades:trades.length,rate:trades.length?wins/trades.length*100:null};}

export const waitLimit=problemCount=>Math.floor(problemCount/2);

// Equal allocations; unfinished rounds remain cash in both portfolios.
export function benchmarkPortfolio(records,settings,count=10){
 const actual=portfolio(records,settings,count);
 const trades=Object.values(records);
 if(trades.some(r=>!Number.isFinite(r.market)))return null;
 const returnPct=trades.reduce((sum,r)=>sum+r.market,0)/count;
 const profit=settings.capital*returnPct/100;
 const excessPct=actual.returnPct-returnPct;
 return {returnPct,profit,balance:settings.capital+profit,excessPct,excessProfit:actual.profit-profit,verdict:excessPct>1e-8?'BEAT':excessPct< -1e-8?'UNDER':'TIE'};
}

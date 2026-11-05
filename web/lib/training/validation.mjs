import {validateSettings,evaluateRound,portfolio,simulateTrade,waitLimit} from '../../public/training/trading.js';
import {endIndex,addMonths} from '../../public/training/engine.js';
export function validateCompleted(input,cases,stocks,run,partial=false){
 const s=input;
 if(!s||s.version!==2||(!partial&&s.pending)||!validateSettings(s.settings)||s.settings.capital!==10000||!Array.isArray(s.order)||s.order.length!==10||new Set(s.order).size!==10||!s.records||typeof s.records!=='object'||Array.isArray(s.records)||Object.keys(s.records).some(id=>!s.order.includes(id))||(!partial&&Object.keys(s.records).length!==10))throw Error(partial?'세션 기록이 올바르지 않습니다.':'완료된 10문제 세션만 저장할 수 있습니다.');
 if(run&&(JSON.stringify(s.order)!==run.ordering||JSON.stringify(s.settings)!==run.settings))throw Error('세션 정보가 일치하지 않습니다.');
 const delays=s.delays??{};
 if(Object.keys(delays).some(id=>!s.order.includes(id))||Object.values(delays).some(n=>!Number.isInteger(n)||n<0)||Object.values(delays).reduce((a,b)=>a+b,0)>waitLimit(s.order.length))throw Error('관망 기록이 올바르지 않습니다.');
 const riskChanges=s.riskChanges??{};if(!riskChanges||typeof riskChanges!=='object'||Array.isArray(riskChanges)||Object.keys(riskChanges).some(id=>!s.order.includes(id)))throw Error('스탑 변경 기록이 올바르지 않습니다.');
 const remainingActions=s.remainingActions??{};if(typeof remainingActions!=='object'||Array.isArray(remainingActions)||Object.keys(remainingActions).some(id=>!s.order.includes(id)))throw Error('잔량 매매 기록이 올바르지 않습니다.');
 const records={};
 for(const id of s.order){
  const c=cases.find(c=>c.id===id),record=s.records[id];
  if(!c||(!record&&!partial)||(record&&!['buy','sell'].includes(record.choice)))throw Error('문제 기록이 올바르지 않습니다.');
  const rows=stocks[c.stockKey??c.symbol].rows,waits=delays[id]??0,cut=c.cut+waits*10,end=endIndex(rows,cut,s.settings.horizonMonths??3);
  if(rows.at(-1)[0]<addMonths(rows[cut][0],s.settings.horizonMonths??3))throw Error('선택한 기간의 문제 기록이 부족합니다.');
  const changes=riskChanges[id]??[];let previous=cut-1;
  if(!Array.isArray(changes)||changes.length>end-cut)throw Error('스탑 변경 기록이 올바르지 않습니다.');
  for(const change of changes){if(!change||!Number.isInteger(change.after)||change.after<cut||change.after>=end||change.after<=previous||!validateSettings({...s.settings,stopPct:change.stopPct,trailingPct:change.trailingPct,trailingSellPct:change.trailingSellPct??s.settings.trailingSellPct}))throw Error('스탑 변경 기록이 올바르지 않습니다.');previous=change.after;}
  const remainingAction=remainingActions[id];
  if(remainingAction){
   if((record?.choice||s.pending?.choice)!=='buy'||!['hold','sell'].includes(remainingAction.action)||!Number.isInteger(remainingAction.after)||remainingAction.after<=cut||remainingAction.after>=end)throw Error('잔량 매매 기록이 올바르지 않습니다.');
   const before=simulateTrade(rows,cut,remainingAction.after,'buy',{...s.settings,changes});if(before.remainingFraction<=0||!before.fills.some(f=>f.reason.startsWith('트레일링')))throw Error('잔량 매매 기록이 올바르지 않습니다.');
  }
  if(record)records[id]={...evaluateRound(rows,cut,end,record.choice,{...s.settings,changes,remainingAction}),waits};
 }
 let pending=null;
 if(partial){
  const completed=Object.keys(records).length;
  if(s.order.slice(0,completed).some(id=>!records[id]))throw Error('문제 진행 순서가 올바르지 않습니다.');
  if(s.pending){
   const p=s.pending,c=cases.find(c=>c.id===p.id),rows=c&&stocks[c.stockKey??c.symbol].rows,cut=c?c.cut+(delays[c.id]??0)*10:0;
   if(!c||p.id!==s.order[completed]||!['buy','sell'].includes(p.choice)||!Number.isInteger(p.reveal)||p.reveal<cut||p.reveal>endIndex(rows,cut,s.settings.horizonMonths??3))throw Error('진행 중인 문제 기록이 올바르지 않습니다.');
   pending={id:p.id,choice:p.choice,reveal:p.reveal};
  }
 }
 const payload={version:2,id:s.id,settings:s.settings,order:s.order,records,delays,riskChanges,remainingActions,pending,
  ...(partial?{runId:s.runId||s.id,owner:run?.owner||null,ranked:Boolean(run?.owner)}:{})};
 return {payload,...portfolio(records,s.settings),correct:Object.values(records).filter(r=>r.correct).length};
}
export const validateProgress=(...args)=>validateCompleted(...args,true);
export const koreaDay=(now=new Date())=>new Date(now.getTime()+9*3600000).toISOString().slice(0,10);

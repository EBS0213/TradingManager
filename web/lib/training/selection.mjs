import {addMonths} from '../../public/training/engine.js';
/** @param {Array<any>} cases @param {{months?:number,exclude?:string[],count?:number,random?:()=>number}} options */
export function selectCases(cases,{months=3,exclude=[],count=10,random=Math.random}={}){
 const eligible=cases.filter(c=>c.stockKey&&!exclude.includes(c.id)&&c.lastDate>=addMonths(c.waitDate,months));
 // Shuffle first, then favor unused companies and the least represented years/patterns.
 const pool=eligible.map(c=>({c,tie:random()})),picked=[],symbols=new Set(),years={},kinds={};
 while(picked.length<count){
  const options=pool.filter(({c})=>!symbols.has(c.symbol));
  if(!options.length)throw Error('선택한 기간의 문제 데이터가 부족합니다.');
  options.sort((a,b)=>(years[a.c.date.slice(0,4)]??0)-(years[b.c.date.slice(0,4)]??0)||(kinds[a.c.kind]??0)-(kinds[b.c.kind]??0)||a.tie-b.tie);
  const c=options[0].c,year=c.date.slice(0,4);picked.push(c.id);symbols.add(c.symbol);years[year]=(years[year]??0)+1;kinds[c.kind]=(kinds[c.kind]??0)+1;
 }
 return picked;
}

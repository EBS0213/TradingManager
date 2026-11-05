export type ChartPoint = {time:string;value:number;open?:number|null;high?:number|null;low?:number|null;volume?:number|null;isComplete?:boolean|null};
export type Timeframe = 'day'|'week'|'month';
export type ChartRange = '5d'|'1m'|'3m'|'6m'|'ytd'|'1y'|'3y'|'5y'|'all';
export const CHART_RANGES:[ChartRange,string][]=[['5d','5일'],['1m','1개월'],['3m','3개월'],['6m','6개월'],['ytd','연초'],['1y','1년'],['3y','3년'],['5y','5년'],['all','전체']];
export function chartRangeStart(end:string,range:ChartRange,daily:ChartPoint[]=[]):string|null{
 if(range==='all')return null;
 if(range==='5d')return daily[Math.max(0,daily.length-5)]?.time||end;
 if(range==='ytd')return end.slice(0,4)+'-01-01';
 const months:Partial<Record<ChartRange,number>>={'1m':1,'3m':3,'6m':6,'1y':12,'3y':36,'5y':60};
 const last=new Date(end+'T00:00:00Z'),start=new Date(Date.UTC(last.getUTCFullYear(),last.getUTCMonth()-months[range]!,1));
 const finalDay=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();
 start.setUTCDate(Math.min(last.getUTCDate(),finalDay));return start.toISOString().slice(0,10);
}
export function chartRangeCount(rows:ChartPoint[],daily:ChartPoint[],range:ChartRange):number{
 if(!rows.length)return 0;const start=chartRangeStart(rows.at(-1)!.time,range,daily);
 return start===null?rows.length:rows.filter(row=>row.time>=start).length;
}
export type ChartLevel = {id:string;label:string;price:number;color:string;dashed?:boolean;includeInScale?:boolean};
export const finite = (value:unknown):number|null => value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
export const priceSeries = (key:string) => key==='bb20'?['bbUpper','bbLower','ma20']:/^ma[0-9]+$/.test(key)||key==='ema20'?[key]:[];
export function chartGeometry(containerWidth:number){
 const width=Math.max(280,Math.round(containerWidth)),baseHeight=width<600?430:Math.max(540,Math.min(680,Math.round(width*.38))),left=14,right=width-120;
 return {width,baseHeight,left,right,plotWidth:right-left,priceTop:22,priceBottom:baseHeight-112,volumeTop:baseHeight-88,volumeBottom:baseHeight-28,dateY:baseHeight-7};
}

// Keep missing OHLC/volume missing; a close observation is not a complete candle.
export function chartPoints(rows:ChartPoint[]):ChartPoint[]{
 const unique=new Map<string,ChartPoint>();
 for(const row of rows){if(!/^\d{4}-\d{2}-\d{2}$/.test(row.time)||finite(row.value)===null||row.value<=0)continue;unique.set(row.time,row);}
 return [...unique.values()].sort((a,b)=>a.time.localeCompare(b.time));
}
export function aggregateBars(rows:ChartPoint[],timeframe:Timeframe):ChartPoint[]{
 if(timeframe==='day')return rows;
 const out:ChartPoint[]=[];let key='';
 for(const row of rows){
  const dt=new Date(row.time+'T00:00:00Z');dt.setUTCDate(dt.getUTCDate()-(dt.getUTCDay()+6)%7);
  const next=timeframe==='month'?row.time.slice(0,7):dt.toISOString().slice(0,10);
  if(next!==key){out.push({...row});key=next;continue;}
  const bar=out[out.length-1];
  bar.time=row.time;bar.value=row.value;
  bar.high=finite(bar.high)===null||finite(row.high)===null?null:Math.max(bar.high!,row.high!);
  bar.low=finite(bar.low)===null||finite(row.low)===null?null:Math.min(bar.low!,row.low!);
  bar.volume=finite(bar.volume)===null||finite(row.volume)===null?null:bar.volume!+row.volume!;
  if(row.isComplete===false)bar.isComplete=false;
 }
 return out;
}
export function sma(values:(number|null)[],period:number):(number|null)[]{
 const out:(number|null)[]=Array(values.length).fill(null);let sum=0,count=0;
 values.forEach((v,i)=>{if(v===null||!Number.isFinite(v)){sum=0;count=0;return;}sum+=v;count++;if(count>period){sum-=values[i-period]!;count=period;}if(count===period)out[i]=sum/period;});return out;
}
export function ema(values:(number|null)[],period:number):(number|null)[]{
 const out:(number|null)[]=Array(values.length).fill(null);let sum=0,count=0,previous:number|null=null;const alpha=2/(period+1);
 values.forEach((v,i)=>{if(v===null||!Number.isFinite(v)){sum=0;count=0;previous=null;return;}if(previous===null){sum+=v;count++;if(count===period){previous=sum/period;out[i]=previous;}}else{previous=alpha*v+(1-alpha)*previous;out[i]=previous;}});return out;
}
export function chartIndicators(rows:ChartPoint[]){
 const close=rows.map(r=>r.value),means=Object.fromEntries([5,10,20,50,60,150,200].map(n=>['ma'+n,sma(close,n)]));
 const bbUpper:(number|null)[]=Array(rows.length).fill(null),bbLower=[...bbUpper],rsi14=[...bbUpper];
 means.ma20.forEach((mean,i)=>{if(mean===null)return;const variance=close.slice(i-19,i+1).reduce((s,v)=>s+(v-mean)**2,0)/20;bbUpper[i]=mean+2*Math.sqrt(variance);bbLower[i]=mean-2*Math.sqrt(variance);});
 let gain=0,loss=0;
 close.forEach((v,i)=>{if(!i)return;const delta=v-close[i-1],g=Math.max(delta,0),l=Math.max(-delta,0);if(i<=14){gain+=g;loss+=l;if(i===14){gain/=14;loss/=14;}}else{gain=(gain*13+g)/14;loss=(loss*13+l)/14;}if(i>=14)rsi14[i]=loss===0?(gain===0?50:100):100-100/(1+gain/loss);});
 const fast=ema(close,12),slow=ema(close,26),macd=close.map((_,i)=>fast[i]===null||slow[i]===null?null:fast[i]!-slow[i]!),signal=ema(macd,9);
 return {...means,ema20:ema(close,20),bbUpper,bbLower,rsi14,macd,signal,histogram:macd.map((v,i)=>v===null||signal[i]===null?null:v-signal[i]!),volume20:sma(rows.map(r=>finite(r.volume)),20)} as Record<string,(number|null)[]>;
}
export function stockLevels(row:Record<string,unknown>|null|undefined,high52?:number|null):ChartLevel[]{
 const read=(...keys:string[])=>keys.map(k=>finite(row?.[k])).find(v=>v!==null&&v>0)??null;
 const high=read('hi52','52주최고')??finite(high52);
 const levels:(Omit<ChartLevel,'price'>&{price:number|null})[]=[
  {id:'pivot',label:'피벗',price:read('피벗가격'),color:'#40d6ca',includeInScale:true},
  {id:'previous',label:'이전피벗',price:read('이전피벗'),color:'#a8b2c2',dashed:true,includeInScale:false},
  {id:'high52',label:'52주고점',price:high,color:'#e6b64c',includeInScale:true},
  {id:'stop',label:'손절',price:read('손절가제안'),color:'#ef7c91',dashed:true,includeInScale:false},
 ];
 return levels.filter((v):v is ChartLevel=>v.price!==null&&v.price>0);
}
export function labelPositions(levels:{id:string;y:number}[],min=24,max=318,gap=17){
 const sorted=levels.toSorted((a,b)=>a.y-b.y).map(v=>({...v,y:Math.max(min,Math.min(max,v.y))}));
 for(let i=1;i<sorted.length;i++)sorted[i].y=Math.max(sorted[i].y,sorted[i-1].y+gap);
 if(sorted.length&&sorted.at(-1)!.y>max){sorted[sorted.length-1].y=max;for(let i=sorted.length-2;i>=0;i--)sorted[i].y=Math.min(sorted[i].y,sorted[i+1].y-gap);}
 return new Map(sorted.map(v=>[v.id,v.y]));
}

export function validCandle(row:ChartPoint):boolean {
 return finite(row.open)!==null&&finite(row.high)!==null&&finite(row.low)!==null&&row.low!>0&&row.high!>=Math.max(row.open!,row.value)&&row.low!<=Math.min(row.open!,row.value);
}

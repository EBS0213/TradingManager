"use client";
import {useId,useMemo,useState} from 'react';
import {aggregateBars,chartIndicators,type Timeframe} from '@/lib/stock-chart';
import type {Bar} from './TradingCommon';
import styles from './TradingWorkspace.module.css';
type Anchor={date:string;price:number};
type Drawing={kind:'line'|'horizontal';a:Anchor;b?:Anchor};
const number=(v:number|null|undefined)=>v==null?'—':v.toLocaleString('ko-KR',{maximumFractionDigits:2});
export default function TrainingChart({rows,symbol,markers=[],decisionDate,annotations=[]}:{rows:Bar[];symbol:string;decisionDate?:string;markers?:{price:number;label:string}[];annotations?:{date:string;price:number;label:string}[]}){
 const clip=useId().replaceAll(':','');
 const [hover,setHover]=useState<number|null>(null),[range,setRange]=useState(120),[timeframe,setTimeframe]=useState<Timeframe>('day');
 const [ma,setMa]=useState(true),[bb,setBb]=useState(false),[rsi,setRsi]=useState(false),[tool,setTool]=useState<'line'|'horizontal'|null>(null),[anchor,setAnchor]=useState<Anchor|null>(null),[drawings,setDrawings]=useState<Drawing[]>([]);
 // Input rows are clipped by the game before aggregation. An unfinished week/month
 // can never read a future daily candle, even when its period is already in the dataset.
 const candles=useMemo(()=>aggregateBars(rows.map(r=>({time:r[0],open:r[1],high:r[2],low:r[3],value:r[4],volume:r[5]})),timeframe),[rows,timeframe]);
 const indicators=useMemo(()=>chartIndicators(candles),[candles]);
 const since=range?rows[Math.max(0,rows.length-range)]?.[0]:rows[0]?.[0];
 const offset=Math.max(0,candles.findIndex(r=>r.time>=since)),visible=candles.slice(offset);
 const chosenIndex=Math.min(hover??visible.length-1,visible.length-1),chosen=visible[chosenIndex];
 if(!visible.length)return <div className={styles.empty}>차트가 없습니다.</div>;
 const values=visible.flatMap(r=>[r.low!,r.high!]);
 for(const a of annotations)if(a.date>=visible[0].time&&a.date<=visible.at(-1)!.time)values.push(a.price);
 if(bb)for(const key of ['bbUpper','bbLower'])for(const v of indicators[key].slice(offset))if(v!==null)values.push(v);
 const lo=Math.min(...values,...markers.map(m=>m.price)),hi=Math.max(...values,...markers.map(m=>m.price)),span=hi-lo||hi*.02||1;
 const floor=lo-span*.08,ceil=hi+span*.08,x=(i:number)=>18+(i+.5)*784/visible.length,y=(v:number)=>325-(v-floor)/(ceil-floor)*300;
 const volume=Math.max(...visible.map(r=>r.volume||0),1),width=Math.max(1,Math.min(9,784/visible.length*.65));
 const decisionIndex=decisionDate?candles.findIndex(r=>r.time>=decisionDate)-offset:-1;
 const timeIndex=(date:string)=>{const i=candles.findIndex(r=>r.time>=date);return i<0?candles.length-offset:i-offset;};
 const point=(date:string,price:number)=>({x:x(timeIndex(date)),y:y(price)});
 const linePath=(key:string,toY=y)=>{let pen=false;return visible.map((_,i)=>{const v=indicators[key][offset+i];if(v===null){pen=false;return '';}const command=pen?'L':'M';pen=true;return command+x(i)+','+toY(v);}).join(' ');};
 const place=(next:Anchor)=>{if(tool==='horizontal'){setDrawings(d=>[...d,{kind:'horizontal',a:next}]);setTool(null);}else if(tool==='line'){if(!anchor)setAnchor(next);else{setDrawings(d=>[...d,{kind:'line',a:anchor,b:next}]);setAnchor(null);setTool(null);}}};
 const toggleTool=(next:'line'|'horizontal')=>{setTool(tool===next?null:next);setAnchor(null);};
 const label=timeframe==='day'?'일봉':timeframe==='week'?'주봉':'월봉';
 const height=rsi?560:430;
 return <div className={styles.chart+' '+styles.trainingChart}>
 <div className={styles.chartToolGroups}>
 <div role="group" aria-label="조회 기간"><span>조회 기간</span><div>{[[60,'60일'],[120,'120일'],[250,'250일'],[0,'전체']].map(([value,label])=><button type="button" key={value} aria-pressed={range===value} onClick={()=>{setRange(Number(value));setHover(null);}}>{label}</button>)}</div></div>
 <div role="group" aria-label="봉 단위"><span>봉 단위</span><div>{([['day','일봉'],['week','주봉'],['month','월봉']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={timeframe===key} onClick={()=>{setTimeframe(key);setHover(null);setAnchor(null);}}>{label}</button>)}</div></div>
 <div role="group" aria-label="보조 지표"><span>지표</span><div><button type="button" aria-pressed={ma} onClick={()=>setMa(!ma)}>이동평균</button><button type="button" aria-pressed={bb} onClick={()=>setBb(!bb)}>볼린저 밴드</button><button type="button" aria-pressed={rsi} onClick={()=>setRsi(!rsi)}>RSI</button></div></div>
 <div role="group" aria-label="차트 그리기"><span>그리기</span><div><button type="button" aria-pressed={tool==='line'} onClick={()=>toggleTool('line')}>추세선</button><button type="button" aria-pressed={tool==='horizontal'} onClick={()=>toggleTool('horizontal')}>수평선</button><button type="button" disabled={!drawings.length&&!anchor} onClick={()=>{if(anchor)setAnchor(null);else setDrawings(d=>d.slice(0,-1));}}>되돌리기</button><button type="button" disabled={!drawings.length&&!anchor} onClick={()=>{setDrawings([]);setAnchor(null);setTool(null);}}>지우기</button></div></div>
 </div>
 {tool&&<div role="status" className={styles.formStatus}>{tool==='line'?(anchor?'끝 지점을 클릭하세요.':'시작 지점과 끝 지점을 차례로 클릭하세요.'):'수평선을 놓을 가격을 클릭하세요.'} · Esc 취소</div>}
 <div className={styles.readout}><strong>{symbol} · {label} · {chosen?.time}</strong>{chosen&&[['O',chosen.open],['H',chosen.high],['L',chosen.low],['C',chosen.value],['V',chosen.volume]].map(([key,value])=><span key={key}> {key} <b>{number(value as number)}</b></span>)}</div>
 <div className={styles.chartIndicatorLegend}>{ma&&[10,20,50,200].map((period,i)=><span key={period} style={{color:['#dfb348','#50b8d7','#bd8ce2','#6e90ed'][i]}}>━ MA {period}</span>)}{bb&&<span style={{color:'#f1f5f9'}}>┄ BB 20 · 2σ</span>}{rsi&&<span>RSI 14 · {number(indicators.rsi14[offset+chosenIndex])}</span>}</div>
 <svg viewBox={'0 0 880 '+height} preserveAspectRatio="none" style={{aspectRatio:'880 / '+height,cursor:tool?'crosshair':undefined}} role="img" aria-label={`${symbol} ${label} 가격 차트${bb?' 볼린저 밴드':''}${rsi?' RSI':''}`} tabIndex={0}
 onPointerMove={e=>{const b=e.currentTarget.getBoundingClientRect();setHover(Math.max(0,Math.min(visible.length-1,Math.floor(((e.clientX-b.left)/b.width*880-18)/784*visible.length))));}} onPointerLeave={()=>setHover(null)}
 onClick={e=>{if(!tool)return;const b=e.currentTarget.getBoundingClientRect(),px=(e.clientX-b.left)/b.width*880,py=(e.clientY-b.top)/b.height*height;if(px<18||px>802||py<25||py>325)return;const i=Math.max(0,Math.min(visible.length-1,Math.floor((px-18)/784*visible.length)));place({date:visible[i].time,price:floor+(325-py)/300*(ceil-floor)});}}
 onKeyDown={e=>{if(e.key==='Escape'){setAnchor(null);setTool(null);}else if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setHover(v=>Math.max(0,Math.min(visible.length-1,(v??visible.length-1)+(e.key==='ArrowRight'?1:-1))));}else if(tool&&['Enter',' '].includes(e.key)){e.preventDefault();place({date:chosen.time,price:chosen.value});}}}>
 <defs><clipPath id={clip}><rect x="18" y="15" width="784" height="320"/></clipPath></defs>
 {[0,.25,.5,.75,1].map(t=><g key={t}><line x1="18" x2="802" y1={y(floor+(ceil-floor)*t)} y2={y(floor+(ceil-floor)*t)} stroke="#262626"/><text x="814" y={y(floor+(ceil-floor)*t)+4}>{number(floor+(ceil-floor)*t)}</text></g>)}
 {visible.map((r,i)=><g key={r.time}><line x1={x(i)} x2={x(i)} y1={y(r.high!)} y2={y(r.low!)} stroke={r.value>=r.open!?'#2fd5a0':'#f27282'}/><rect x={x(i)-width/2} width={width} y={Math.min(y(r.open!),y(r.value))} height={Math.max(1,Math.abs(y(r.open!)-y(r.value)))} fill={r.value>=r.open!?'#2fd5a0':'#f27282'}/><rect x={x(i)-width/2} width={width} y={403-(r.volume||0)/volume*55} height={(r.volume||0)/volume*55} fill={r.value>=r.open!?'#225d4b':'#63333e'}/></g>)}
 <g clipPath={'url(#'+clip+')'}>{ma&&[10,20,50,200].map((n,j)=><path key={n} d={linePath('ma'+n)} fill="none" stroke={['#dfb348','#50b8d7','#bd8ce2','#6e90ed'][j]} strokeWidth="1.2"/>)}{bb&&['bbUpper','bbLower',...(!ma?['ma20']:[])].map(key=><path key={key} d={linePath(key)} fill="none" stroke={key==='ma20'?'#50b8d7':'#f1f5f9'} strokeWidth={key==='ma20'?1.2:1.8} strokeDasharray={key==='ma20'?undefined:'6 4'}/>)}</g>
 {decisionIndex>=0&&decisionIndex<visible.length&&<g><line x1={x(decisionIndex)} x2={x(decisionIndex)} y1="15" y2="404" stroke="#f2ac43" strokeDasharray="5 4"/><text x={Math.min(690,x(decisionIndex)+5)} y="22">판단일 · 이후 결과</text></g>}
 {markers.map(m=><g key={m.label}><line x1="18" x2="802" y1={y(m.price)} y2={y(m.price)} stroke="#e9ae4b" strokeDasharray="5 4"/><text x="24" y={y(m.price)-5}>{m.label} {number(m.price)}</text></g>)}
 {annotations.map((a,i)=>{const index=timeIndex(a.date);if(index<0||index>=visible.length)return null;const px=x(index),py=y(a.price),tx=Math.max(24,Math.min(660,px-60)),ty=40+(i%3)*38;return <g key={a.date+a.label} aria-label={a.label+' '+a.date}><line x1={px} x2={tx+60} y1={py} y2={ty+20} stroke="#fff" strokeWidth="1.5" strokeDasharray="3 3"/><circle cx={px} cy={py} r="5" fill="#090b0e" stroke="#fff" strokeWidth="2"/><rect x={tx} y={ty} width="130" height="25" rx="3" fill="#202b36" stroke="#e5edf5"/><text x={tx+6} y={ty+17} style={{fill:'#fff',fontSize:12}}>{i+1}. {a.label}</text></g>;})}
 <g clipPath={'url(#'+clip+')'}>{drawings.map((d,i)=>{const a=point(d.a.date,d.a.price),b=d.b?point(d.b.date,d.b.price):a;return <line key={i} aria-label={d.kind==='line'?'그린 추세선':'그린 수평선'} x1={d.kind==='horizontal'?18:a.x} x2={d.kind==='horizontal'?802:b.x} y1={a.y} y2={b.y} stroke="#ff3dbb" strokeWidth="3"/>;})}{anchor&&<circle cx={point(anchor.date,anchor.price).x} cy={y(anchor.price)} r="4" fill="#ff3dbb"/>}</g>
 {rsi&&<g aria-label="RSI 지표"><rect x="18" y="438" width="784" height="100" fill="#100d17"/>{[0,30,70,100].map(value=><g key={value}><line x1="18" x2="802" y1={538-value} y2={538-value} stroke="#393140" strokeDasharray="4 4"/><text x="814" y={542-value}>{value}</text></g>)}<text x="24" y="451">RSI 14</text><path d={linePath('rsi14',v=>538-v)} fill="none" stroke="#c49aff" strokeWidth="1.5"/></g>}
 {hover!==null&&<line x1={x(chosenIndex)} x2={x(chosenIndex)} y1="15" y2={rsi?538:404} stroke="#888" strokeDasharray="3 4"/>}
 <text x="18" y="424">{visible[0].time}</text><text x="802" y="424" textAnchor="end">{visible.at(-1)?.time}</text></svg>
 </div>;
}

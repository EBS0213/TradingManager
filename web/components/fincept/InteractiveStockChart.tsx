"use client";

import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import type {IChartApi,LogicalRange,ISeriesPrimitive,Time} from 'lightweight-charts';
import {setupChartLevels,type SetupZone} from '@/lib/setup-chart';
import {validCandle,aggregateBars,CHART_RANGES,chartRangeCount,chartGeometry,chartIndicators,chartPoints,finite,priceSeries,type ChartPoint,type ChartLevel,type Timeframe,type ChartRange} from '@/lib/stock-chart';
import styles from './StockPriceChart.module.css';

const options=[['ma5','MA 5','#e5bd5b'],['ma10','MA 10','#e9a36c'],['ma20','MA 20','#50b8d7'],['ma50','MA 50','#97b4ef'],['ma60','MA 60','#bd8ce2'],['ma150','MA 150','#6e90ed'],['ma200','MA 200','#bbad91'],['ema20','EMA 20','#ffbd63'],['bb20','Bollinger 20 · 2σ · 점선','#f1f5f9'],['rsi14','RSI 14','#c49aff'],['macd','MACD 12 · 26 · 9','#5ab8ff']] as const;
const defaults:Record<string,boolean>={ma5:true,ma20:true,ma60:true,ma150:true,pivot:true,previous:true,high52:true,stop:false,volume20:true};
const price=(value:unknown)=>finite(value)===null?'—':Number(value).toLocaleString('ko-KR',{maximumFractionDigits:2});
const empty:ChartPoint[]=[];
type DrawPoint={time:string;price:number};
type Drawing={kind:'trend'|'horizontal';a:DrawPoint;b?:DrawPoint};
type Props={daily:ChartPoint[];weekly?:ChartPoint[];monthly?:ChartPoint[];levels:ChartLevel[];setup?:SetupZone;symbol:string;currency:string;tradingLevels:boolean;onLongRange:()=>void;historyPending:boolean;historyLoaded:boolean;status:ReactNode};
function setupPrimitive(chart:IChartApi,series:{priceToCoordinate:(price:number)=>number|null},rows:ChartPoint[],setup:SetupZone):ISeriesPrimitive<Time>{
 return {paneViews:()=>[{zOrder:()=>'bottom',renderer:()=>({draw(target){target.useMediaCoordinateSpace(({context:ctx,mediaSize:size})=>{
  const begin=setup.baseStart?.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),date=(begin?rows.find(r=>r.time>=begin):rows[0])?.time;
  const from=Math.max(0,date?chart.timeScale().timeToCoordinate(date)??0:0);
  const band=(a:number,b:number,color:string)=>{const ya=series.priceToCoordinate(a),yb=series.priceToCoordinate(b);if(ya===null||yb===null)return;ctx.fillStyle=color;ctx.fillRect(from,Math.min(ya,yb),Math.max(0,size.width-from),Math.abs(ya-yb));};
  ctx.save();ctx.beginPath();ctx.rect(0,0,size.width,size.height);ctx.clip();band(setup.pivot,setup.pivot*1.05,'rgba(47,111,214,.16)');
  if(typeof setup.stop==='number'&&setup.stop>0&&setup.stop<setup.pivot)band(setup.stop,setup.pivot,'rgba(231,76,101,.15)');ctx.restore();
 });}})}]};
}
export default function InteractiveStockChart({daily,weekly=empty,monthly=empty,levels,setup,symbol,currency,tradingLevels,onLongRange,historyPending,historyLoaded,status}:Props){
 const root=useRef<HTMLDivElement>(null),host=useRef<HTMLDivElement>(null),api=useRef<IChartApi|null>(null);
 const [drawMode,setDrawMode]=useState<'trend'|'horizontal'|null>(null),[drawAnchor,setDrawAnchor]=useState<DrawPoint|null>(null),[drawings,setDrawings]=useState<Drawing[]>([]);
 const drawingState=useRef({mode:drawMode,anchor:drawAnchor});drawingState.current={mode:drawMode,anchor:drawAnchor};
 const manual=useRef(false),saved=useRef<{from:number;to:number}|null>(null),userInput=useRef(false);
 const [width,setWidth]=useState(880),[timeframe,setTimeframe]=useState<Timeframe>('day'),[range,setRange]=useState<ChartRange>('1y'),[display,setDisplay]=useState('candle'),[log,setLog]=useState(false),[settings,setSettings]=useState(defaults),[hover,setHover]=useState<string|null>(null),[resetToken,setResetToken]=useState(0),[isManual,setIsManual]=useState(false),[windowRange,setWindowRange]=useState({from:0,to:0}),[error,setError]=useState('');
 useEffect(()=>{if(!root.current)return;const observer=new ResizeObserver(entries=>{const w=Math.round(entries[0].contentRect.width);if(w>0)setWidth(w);});observer.observe(root.current);return ()=>observer.disconnect();},[]);
 const rows=useMemo(()=>{const recent=aggregateBars(daily,timeframe),old=timeframe==='week'?weekly:timeframe==='month'?monthly:empty;return old.length?chartPoints([...old.filter(r=>r.time<(recent[0]?.time||'')),...recent]):recent;},[daily,timeframe,weekly,monthly]);
 const indicators=useMemo(()=>chartIndicators(rows),[rows]);
 const setupKey=JSON.stringify(setup);
 const activeSetup=useMemo<SetupZone|undefined>(()=>setupKey?JSON.parse(setupKey):undefined,[setupKey]);
 const enabledLevels=useMemo(()=>[...levels.filter(level=>settings[level.id]),...setupChartLevels(activeSetup)],[levels,settings,activeSetup]);
 const count=useMemo(()=>chartRangeCount(rows,daily,range),[rows,daily,range]);
 const height=chartGeometry(width).baseHeight+['rsi14','macd'].filter(key=>settings[key]).length*120;
 const markManual=()=>{manual.current=true;setIsManual(true);};
 const reset=(next:ChartRange)=>{manual.current=false;saved.current=null;setIsManual(false);setRange(next);setHover(null);setResetToken(v=>v+1);if(['3y','5y','all'].includes(next))onLongRange();};
 useEffect(()=>{
  const node=host.current;if(!node||!rows.length||display==='table')return;
  let disposed=false,chart:IChartApi|null=null;
  setError('');
  void import('lightweight-charts').then(L=>{
   if(disposed)return;
   chart=L.createChart(node,{
    autoSize:true,height,layout:{background:{type:L.ColorType.Solid,color:'#090909'},textColor:'#aeb6c2',fontSize:11,attributionLogo:true,panes:{separatorColor:'#303030',separatorHoverColor:'#665033',enableResize:true}},
    grid:{vertLines:{visible:false},horzLines:{color:'#252525'}},crosshair:{mode:L.CrosshairMode.Normal},
    rightPriceScale:{mode:log?L.PriceScaleMode.Logarithmic:L.PriceScaleMode.Normal,borderColor:'#333',minimumWidth:80,scaleMargins:{top:.08,bottom:.08}},
    timeScale:{borderColor:'#333',rightOffset:0,fixRightEdge:true,fixLeftEdge:true,minBarSpacing:.1,timeVisible:false},
    handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true,axisDoubleClickReset:true},kineticScroll:{touch:true,mouse:true},
    localization:{locale:'ko-KR',priceFormatter:price},
   });
   api.current=chart;userInput.current=false;
   const format={type:'price' as const,precision:currency==='KRW'?0:2,minMove:currency==='KRW'?1:.01};
   const scaleLevels=enabledLevels.filter(level=>level.includeInScale);
   const autoscaleInfoProvider:import('lightweight-charts').AutoscaleInfoProvider=original=>{const info=original();if(info?.priceRange)for(const level of scaleLevels){info.priceRange.minValue=Math.min(info.priceRange.minValue,level.price);info.priceRange.maxValue=Math.max(info.priceRange.maxValue,level.price);}return info;};
   const main=display==='line'?chart.addSeries(L.LineSeries,{color:'#efb54e',lineWidth:2,priceFormat:format,autoscaleInfoProvider}):chart.addSeries(L.CandlestickSeries,{upColor:'#35d7a2',downColor:'#f47786',borderVisible:false,wickUpColor:'#35d7a2',wickDownColor:'#f47786',priceFormat:format,autoscaleInfoProvider});
   if(display==='line')main.setData(rows.map(row=>({time:row.time,value:row.value})));
   else{
    main.setData(rows.map(row=>validCandle(row)?{time:row.time,open:row.open!,high:row.high!,low:row.low!,close:row.value}:{time:row.time}));
    if(rows.some(row=>!validCandle(row))){const close=chart.addSeries(L.LineSeries,{color:'#efb54e',lineWidth:1,pointMarkersVisible:true,priceLineVisible:false,lastValueVisible:false,priceFormat:format,autoscaleInfoProvider});close.setData(rows.map(row=>validCandle(row)?{time:row.time}:{time:row.time,value:row.value}));}
   }
   const line=(key:string,color:string,pane=0)=>{const series=chart!.addSeries(L.LineSeries,{color,lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:true,priceFormat:pane?{type:'price',precision:2,minMove:.01}:format},pane);series.setData(rows.map((row,index)=>indicators[key][index]===null?{time:row.time}:{time:row.time,value:indicators[key][index]!}));return series;};
   for(const [key,,color] of options)if(settings[key])for(const series of priceSeries(key)){if(key==='bb20'&&series==='ma20'&&settings.ma20)continue;const plotted=line(series,key==='bb20'&&series==='ma20'?'#50b8d7':color);if(key==='bb20'&&series!=='ma20')plotted.applyOptions({lineStyle:L.LineStyle.Dashed,lineWidth:2});}
   for(const level of enabledLevels)main.createPriceLine({price:level.price,title:level.label,color:level.color,lineWidth:1,lineStyle:level.dashed?L.LineStyle.Dashed:L.LineStyle.Solid,axisLabelVisible:true});
   if(activeSetup&&setupChartLevels(activeSetup).length)main.attachPrimitive(setupPrimitive(chart,main,rows,activeSetup));
   for(const drawing of drawings){
    if(drawing.kind==='horizontal'){main.createPriceLine({price:drawing.a.price,title:'수평선',color:'#ff3dbb',lineWidth:3,lineStyle:L.LineStyle.Solid,axisLabelVisible:true});continue;}
    if(!drawing.b)continue;
    const snap=(point:DrawPoint)=>({time:rows.find(row=>row.time>=point.time)?.time||rows.at(-1)!.time,value:point.price});
    const points=[snap(drawing.a),snap(drawing.b)].sort((a,b)=>a.time.localeCompare(b.time));
    if(points[0].time===points[1].time)continue;
    const drawn=chart.addSeries(L.LineSeries,{color:'#ff3dbb',lineWidth:3,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,autoscaleInfoProvider:()=>null});drawn.setData(points);
   }
   chart.subscribeClick(event=>{
    const state=drawingState.current;if(!state.mode||!event.point||!event.time||(event.paneIndex??0)!==0)return;
    const time=typeof event.time==='string'?event.time:typeof event.time==='object'?`${event.time.year}-${String(event.time.month).padStart(2,'0')}-${String(event.time.day).padStart(2,'0')}`:null;
    const value=main.coordinateToPrice(event.point.y);if(!time||value===null||value<=0||!rows.some(row=>row.time===time))return;
    const point={time,price:Number(value)};
    if(state.mode==='horizontal'){setDrawings(old=>[...old,{kind:'horizontal',a:point}]);setDrawMode(null);setDrawAnchor(null);}
    else if(!state.anchor){setDrawAnchor(point);}
    else if(state.anchor.time!==time){setDrawings(old=>[...old,{kind:'trend',a:state.anchor!,b:point}]);setDrawAnchor(null);setDrawMode(null);}
   });
   const volume=chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false},1);
   volume.setData(rows.map(row=>finite(row.volume)!==null&&row.volume!>=0?{time:row.time,value:row.volume!,color:row.value>=(row.open??row.value)?'#245d49':'#63333e'}:{time:row.time}));
   if(settings.volume20)line('volume20','#929aa6',1).applyOptions({priceFormat:{type:'volume'}});
   let pane=2;
   if(settings.rsi14){const rsi=line('rsi14','#c49aff',pane++);rsi.applyOptions({autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});for(const value of [30,70])rsi.createPriceLine({price:value,color:'#555',lineStyle:L.LineStyle.Dashed,lineWidth:1,axisLabelVisible:true,title:''});}
   if(settings.macd){line('macd','#5ab8ff',pane);line('signal','#ffbd63',pane);const hist=chart.addSeries(L.HistogramSeries,{priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'price',precision:2,minMove:.01}},pane);hist.setData(rows.map((row,i)=>indicators.histogram[i]===null?{time:row.time}:{time:row.time,value:indicators.histogram[i]!,color:indicators.histogram[i]!>=0?'#245d49':'#63333e'}));}
   chart.panes().forEach((p,i)=>p.setStretchFactor(i===0?5:i===1?1:1.35));
   const initial=saved.current&&manual.current?{from:rows.length+saved.current.from,to:rows.length+saved.current.to}:{from:Math.max(-.5,rows.length-Math.max(2,count)-.5),to:rows.length-1};
   chart.timeScale().setVisibleLogicalRange(initial as LogicalRange);
   const update=(value:LogicalRange|null)=>{if(!value)return;saved.current={from:value.from-rows.length,to:value.to-rows.length};const next={from:Math.max(0,Math.ceil(value.from)),to:Math.min(rows.length,Math.floor(value.to)+1)};setWindowRange(old=>old.from===next.from&&old.to===next.to?old:next);};
   const initialRange=chart.timeScale().getVisibleLogicalRange();update(initialRange);
   chart.timeScale().subscribeVisibleLogicalRangeChange(value=>{update(value);if(value&&userInput.current){manual.current=true;setIsManual(true);}});
   chart.subscribeCrosshairMove(event=>{const time=event.time;setHover(typeof time==='string'?time:time&&typeof time==='object'?`${time.year}-${String(time.month).padStart(2,'0')}-${String(time.day).padStart(2,'0')}`:null);});
  }).catch(reason=>{if(!disposed)setError(reason instanceof Error?reason.message:'차트 초기화 실패');});
  return ()=>{disposed=true;if(api.current===chart)api.current=null;chart?.remove();};
 },[rows,indicators,enabledLevels,settings,display,log,currency,height,count,resetToken,activeSetup,drawings]);
 const selected=rows.find(row=>row.time===hover)||rows.at(Math.max(0,Math.min(rows.length-1,windowRange.to-1)))||rows.at(-1);
 const visible=display==='table'&&!isManual?rows.slice(-Math.max(1,count)):rows.slice(windowRange.from,windowRange.to||rows.length);
 const move=(delta:number)=>{const scale=api.current?.timeScale(),current=scale?.getVisibleLogicalRange();if(!scale||!current)return;markManual();const shift=delta*(current.to-current.from)/4;const to=Math.min(rows.length-1,current.to+shift);scale.setVisibleLogicalRange({from:to-(current.to-current.from),to} as LogicalRange);};
 const zoom=(factor:number)=>{const scale=api.current?.timeScale(),current=scale?.getVisibleLogicalRange();if(!scale||!current)return;markManual();const size=Math.max(5,(current.to-current.from)*factor);scale.setVisibleLogicalRange({from:current.to-size,to:current.to} as LogicalRange);};
 const toggle=(key:string)=>setSettings(old=>({...old,[key]:!old[key]}));
 return <div className={styles.root} ref={root}>
  <div className={styles.toolbar}>
   <div role="group" aria-label="봉 단위">{([['day','일봉'],['week','주봉'],['month','월봉']] as const).map(([key,label])=><button key={key} type="button" aria-pressed={timeframe===key} onClick={()=>{manual.current=false;saved.current=null;setIsManual(false);setTimeframe(key);setHover(null);}}>{label}</button>)}</div>
   <div role="group" aria-label="차트 기간">{CHART_RANGES.map(([key,label])=><button key={key} type="button" aria-pressed={!isManual&&range===key} onClick={()=>reset(key)}>{label}</button>)}</div>
   <div role="group" aria-label="차트 표시">{[['candle','캔들'],['line','선'],['table','표']].map(([key,label])=><button key={key} type="button" aria-pressed={display===key} onClick={()=>setDisplay(key)}>{label}</button>)}<button type="button" aria-pressed={log} onClick={()=>setLog(!log)}>로그</button></div>
   <div role="group" aria-label="주요 보조지표">{[['bb20','볼린저 밴드'],['rsi14','RSI'],['macd','MACD']].map(([key,label])=><button type="button" key={key} aria-pressed={!!settings[key]} onClick={()=>toggle(key)}>{label}</button>)}</div>
   <div role="group" aria-label="차트 그리기">{([['trend','추세선'],['horizontal','수평선']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={drawMode===key} disabled={display==='table'} onClick={()=>{setDrawMode(drawMode===key?null:key);setDrawAnchor(null);}}>{label}</button>)}<button type="button" disabled={!drawings.length&&!drawAnchor} onClick={()=>{if(drawAnchor)setDrawAnchor(null);else setDrawings(old=>old.slice(0,-1));}}>되돌리기</button><button type="button" disabled={!drawings.length&&!drawAnchor} onClick={()=>{setDrawings([]);setDrawAnchor(null);setDrawMode(null);}}>지우기</button></div>
   <details className={styles.settings} onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}><summary>차트 설정</summary><div role="group" aria-label="차트 지표 설정">{[...options.map(([key,label])=>[key,label]),...(tradingLevels?[['pivot','피벗'],['previous','이전피벗'],['high52','52주고점'],['stop','손절선']]:[]),['volume20','거래량 MA 20']].map(([key,label])=><label key={key}><input type="checkbox" checked={!!settings[key]} onChange={()=>toggle(key)}/>{label}</label>)}</div></details>
  </div>
  <div className={styles.navigation}><div role="group" aria-label="차트 이동 및 확대"><button type="button" aria-label="이전 구간" disabled={!rows.length||display==='table'} onClick={()=>move(-1)}>◀</button><button type="button" aria-label="차트 축소" disabled={!rows.length||display==='table'} onClick={()=>zoom(1.5)}>−</button><button type="button" aria-label="차트 확대" disabled={!rows.length||display==='table'} onClick={()=>zoom(1/1.5)}>＋</button><button type="button" aria-label="다음 구간" disabled={!rows.length||display==='table'||windowRange.to>=rows.length} onClick={()=>move(1)}>▶</button><button type="button" onClick={()=>reset(range)}>최근</button></div><button type="button" disabled={historyPending||historyLoaded} onClick={onLongRange}>{historyPending?'불러오는 중…':historyLoaded?'과거 데이터 적용됨':'과거 데이터'}</button><span>{visible.length.toLocaleString('ko-KR')} / {rows.length.toLocaleString('ko-KR')}봉 · {currency}</span></div>
  {drawMode?<div className={styles.status} role="status">{drawMode==='horizontal'?'수평선을 놓을 가격을 클릭하세요.':drawAnchor?'다른 날짜의 끝 지점을 클릭하세요.':'시작 지점과 끝 지점을 차례로 클릭하세요.'} · Esc 취소</div>:null}
  {status}
  <div className={styles.legend}>{options.filter(([key])=>settings[key]).map(([key,label,color])=><span key={key}><i style={key==='bb20'?{background:'transparent',borderTop:'2px dashed '+color}:{background:color}}/>{label}</span>)}{enabledLevels.map(level=><span key={level.id} style={{color:level.color}}><i style={{background:level.color}}/>{level.label} {price(level.price)}</span>)}{settings.volume20?<span><i style={{background:'#929aa6'}}/>거래량 MA 20</span>:null}</div>
  {selected?<div className={styles.readout}><strong>{selected.time}</strong>{[['O',selected.open],['H',selected.high],['L',selected.low],['C',selected.value],['V',selected.volume]].map(([key,value])=><span key={String(key)}>{key} <b>{price(value)}</b></span>)}{selected.isComplete===false?<em>미완료 봉</em>:null}</div>:null}
  {!rows.length?<div className={styles.status} role="status">제공된 일봉이 없습니다.</div>:display==='table'?<div className={styles.table}><table><caption>{symbol} · {currency}</caption><thead><tr>{['거래일','시가','고가','저가','종가','거래량'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{visible.toReversed().map(row=><tr key={row.time}><th>{row.time}{row.isComplete===false?' *':''}</th>{[row.open,row.high,row.low,row.value,row.volume].map((v,i)=><td key={i}>{price(v)}</td>)}</tr>)}</tbody></table></div>:<div className={styles.chart} style={{height}} ref={host} role="img" aria-label={`${symbol} ${currency} 가격 차트`} tabIndex={0}
   onWheelCapture={()=>{userInput.current=true;}} onMouseDownCapture={()=>{userInput.current=true;}} onTouchStartCapture={()=>{userInput.current=true;}}
   onKeyDown={e=>{if(e.key==='Escape'){setDrawMode(null);setDrawAnchor(null);}if(['ArrowLeft','ArrowRight','+','-','Home','End'].includes(e.key)){e.preventDefault();if(e.key==='+'||e.key==='-')zoom(e.key==='+'?1/1.5:1.5);else if(e.key==='Home'||e.key==='End')reset(range);else move(e.key==='ArrowLeft'?-1:1);}}}/>} 
  {error?<div className={styles.status} role="alert">차트를 불러오지 못했습니다. <button type="button" onClick={()=>setResetToken(v=>v+1)}>다시 시도</button></div>:null}
 </div>;
}

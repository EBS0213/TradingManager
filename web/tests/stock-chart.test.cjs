const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{QueryClient,QueryClientProvider}=require('@tanstack/react-query');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,name.slice(2)):name,parent,...rest);};
require.extensions['.ts']=require.extensions['.tsx']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
require.extensions['.css']=module=>{module.exports={__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};};
const {validCandle,aggregateBars,chartPoints,chartIndicators,stockLevels,labelPositions,priceSeries,chartGeometry,chartRangeStart,chartRangeCount}=require('../lib/stock-chart.ts'),Chart=require('../components/fincept/StockPriceChart.tsx').default;
const bars=Array.from({length:210},(_,i)=>({time:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:100+i,high:102+i,low:99+i,value:101+i,volume:1000+i}));
function render(props){const q=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});q.setQueryData(['workspace-account'],{signedIn:false});return renderToStaticMarkup(React.createElement(QueryClientProvider,{client:q},React.createElement(Chart,{symbol:'018470',market:'KR',points:bars,metadata:null,tradingLevels:true,...props})));}
test('weekly/monthly aggregation preserves first open, extrema, last close and volume',()=>{
 const rows=[{time:'2026-09-28',open:10,high:15,low:9,value:14,volume:100},{time:'2026-09-30',open:14,high:18,low:12,value:16,volume:200},{time:'2026-10-01',open:16,high:17,low:11,value:12,volume:300},{time:'2026-10-05',open:12,high:13,low:10,value:11,volume:400}];
 assert.deepEqual(aggregateBars(rows,'week')[0],{time:'2026-10-01',open:10,high:18,low:9,value:12,volume:600});
 assert.deepEqual(aggregateBars(rows,'month')[0],{time:'2026-09-30',open:10,high:18,low:9,value:16,volume:300});
 const missing=structuredClone(rows);missing[1].volume=null;missing[1].high=null;assert.equal(aggregateBars(missing,'week')[0].volume,null);assert.equal(aggregateBars(missing,'week')[0].high,null);
});
test('indicators use full prior history and keep insufficient observations empty',()=>{
 assert.deepEqual(priceSeries('macd'),[]);assert.deepEqual(priceSeries('rsi14'),[]);assert.deepEqual(priceSeries('ma150'),['ma150']);
 const result=chartIndicators(bars);assert.equal(result.ma150[148],null);assert.equal(result.ma150[149],175.5);assert.equal(result.ma20[209],300.5);assert.equal(result.volume20[209],1199.5);assert.equal(result.rsi14[14],100);assert.equal(result.rsi14[13],null);assert.equal(result.signal[32],null);assert.equal(result.macd[209].toFixed(5),'7.00000');assert(Math.abs(result.histogram[209])<1e-10);
 const flat=chartIndicators(bars.map(r=>({...r,value:100})));assert.equal(flat.rsi14[209],50);assert.equal(flat.bbUpper[209],100);assert.equal(flat.bbLower[209],100);
});
test('pivot levels are snapshot values and never guessed from local highs',()=>{
 const levels=stockLevels({'피벗가격':5280,'이전피벗':5450,'52주최고':5450,'손절가제안':5010});assert.deepEqual(levels.map(v=>[v.id,v.price]),[['pivot',5280],['previous',5450],['high52',5450],['stop',5010]]);assert.equal(levels.find(v=>v.id==='previous').includeInScale,false);
 assert.deepEqual(stockLevels(null),[]);assert.deepEqual(stockLevels({'피벗가격':null,'이전피벗':'','52주최고':-1,'손절가제안':0}),[]);assert.equal(stockLevels(null,6000)[0].price,6000);
});
test('equal and nearby level labels remain separated within the plotting area',()=>{
 const labels=labelPositions([{id:'a',y:20},{id:'b',y:20},{id:'c',y:317},{id:'d',y:318}]);const values=[...labels.values()];assert(values[0]>=24);assert(values.at(-1)<=318);for(let i=1;i<values.length;i++)assert(values[i]-values[i-1]>=17);
});
test('shared chart exposes real snapshot levels, indicator selection and history controls',()=>{
 const html=render({metadata:{'피벗가격':300,'이전피벗':295,'52주최고':320,'손절가제안':280}});for(const label of ['피벗 300','이전피벗 295','52주고점 320','일봉','주봉','월봉','차트 설정','Bollinger','RSI 14','MACD','차트 확대','이전 구간','과거 데이터'])assert(html.includes(label),label);assert(html.includes('MA 150'));assert(html.includes('거래량 MA 20'));assert(html.includes('가격 차트'));assert(!html.includes('손절 280'));assert(!html.includes('NaN'));
});
test('missing OHLC cannot be rendered as complete candles and distant levels stay available',()=>{
 const html=render({metadata:{'이전피벗':1}});assert(html.includes('이전피벗 1'));
 const closeOnly=render({points:[{time:'2026-10-21',value:100},{time:'2026-10-22',value:101}]});assert(closeOnly.includes('가격 차트'));assert.equal(validCandle({time:'2026-10-22',value:101}),false);assert.equal(validCandle({...bars[0],high:1}),false);assert.equal(validCandle(bars[0]),true);assert(!closeOnly.includes('>NaN<'));
 assert.deepEqual(chartPoints([{time:'bad',value:10},{time:'2026-10-22',value:NaN},{time:'2026-10-21',value:100}]),[{time:'2026-10-21',value:100}]);
});

test('terminal charts omit all trading levels and their controls even with metadata available',()=>{
 const html=render({tradingLevels:false,metadata:{'피벗가격':300,'이전피벗':295,'52주최고':320,'손절가제안':280},high52:320});
 assert.doesNotMatch(html,/피벗|이전피벗|52주고점|손절선|data-level/);assert.match(html,/1개월/);assert.match(html,/3개월/);assert.match(html,/6개월/);assert.match(html,/1년/);assert.match(html,/5년/);assert.doesNotMatch(html,/250일|500일|1000일/);
});
test('wide panels gain both plotting width and height without a centered fixed aspect chart',()=>{
 const narrow=chartGeometry(800),wide=chartGeometry(2000);assert(wide.plotWidth>1800);assert(wide.priceBottom-wide.priceTop>500);assert(wide.baseHeight>narrow.baseHeight);assert.equal(wide.width,2000);assert(chartGeometry(390).plotWidth>240);
});

test('calendar ranges clamp month ends and leap days rather than treating months as bar counts',()=>{
 assert.equal(chartRangeStart('2024-03-31','1m'),'2024-02-29');assert.equal(chartRangeStart('2025-03-31','1m'),'2025-02-28');assert.equal(chartRangeStart('2024-02-29','1y'),'2023-02-28');assert.equal(chartRangeStart('2026-10-22','3m'),'2026-07-22');assert.equal(chartRangeStart('2026-10-22','ytd'),'2026-01-01');assert.equal(chartRangeStart('2026-10-22','all'),null);
});
test('calendar ranges retain their time span across candle timeframes and use the last observation',()=>{
 const daily=Array.from({length:730},(_,i)=>({time:new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10),value:100}));
 const start=chartRangeStart(daily.at(-1).time,'3m',daily);
 for(const frame of ['day','week','month']){const rows=aggregateBars(daily,frame),count=chartRangeCount(rows,daily,'3m');assert.equal(count,rows.filter(r=>r.time>=start).length);assert.equal(rows.slice(-count).at(-1).time,daily.at(-1).time);}
 assert.equal(chartRangeCount(daily,daily,'5d'),5);assert.equal(chartRangeCount(daily,daily,'all'),730);
});

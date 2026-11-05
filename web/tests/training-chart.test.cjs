const fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,name.slice(2)):name,parent,...rest);};
require.extensions['.tsx']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
require.extensions['.ts']=require.extensions['.tsx'];require.extensions['.css']=module=>{module.exports={__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};};
const React=require(root+'/node_modules/react'),{renderToStaticMarkup}=require(root+'/node_modules/react-dom/server'),Chart=require(root+'/components/fincept/trading/TrainingChart.tsx').default;
const cases=JSON.parse(fs.readFileSync(root+'/public/training/data/cases.json')),c=cases[0],rows=JSON.parse(fs.readFileSync(root+'/public/training/data/'+c.symbol+'.json')).rows.slice(0,c.cut+1);
const html=renderToStaticMarkup(React.createElement(Chart,{rows,symbol:c.symbol,decisionDate:rows.at(-1)[0]}));
const assert=require('node:assert/strict');for(const label of ['조회 기간','봉 단위','보조 지표','차트 그리기','볼린저 밴드','RSI','추세선','수평선','일봉','주봉','월봉'])assert.ok(html.includes(label),label);assert.ok(!html.includes('NaN'));
const {aggregateBars,chartIndicators}=require(root+'/lib/stock-chart.ts');const daily=rows.map(r=>({time:r[0],open:r[1],high:r[2],low:r[3],value:r[4],volume:r[5]}));for(const frame of ['week','month']){const bars=aggregateBars(daily,frame);assert.equal(bars.at(-1).value,rows.at(-1)[4]);assert.equal(bars.at(-1).time,rows.at(-1)[0]);const values=chartIndicators(bars);assert.ok(values.rsi14.filter(v=>v!==null).every(v=>v>=0&&v<=100));}
console.log('Chart toolbar rendering, clipped weekly/monthly candles and RSI bounds passed');
const annotated=renderToStaticMarkup(React.createElement(Chart,{rows,symbol:c.symbol,annotations:[{date:rows.at(-1)[0],price:rows.at(-1)[4],label:'판단 · PASS'}]}));
assert.ok(annotated.includes('판단 · PASS'));
assert.ok(!html.includes('판단 · PASS'));
assert.ok(!annotated.includes('NaN'));

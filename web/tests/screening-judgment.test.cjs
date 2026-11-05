const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,name.slice(2)):name,parent,...rest);};
require.extensions['.tsx']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
require.extensions['.ts']=require.extensions['.tsx'];
require.extensions['.css']=module=>{module.exports={__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};};
const Table=require('../components/fincept/trading/ScreeningTable.tsx').default;
const row={코드:'123456',종목명:'판단 항목 테스트',업종:'반도체',시장:'KOSDAQ',편입상태:'NEW',현재가:100,등락률:.02,종합점수:81.5,RS:92,'52주최고':120,피벗가격:105,피벗대비이격:-.0476,거래대금:150000000,거래대금20일:100000000,최근거래량_비율:.65,거래량추이:'1|2|3|2|1',주가추이:'90|92|95|96|98|100',UD비율:1.5,매집판정:'유입',수급판정:'쌍끌이',외국인20일:12345,기관20일:67890,EPS증가율:999,EPS전년:-100,EPS당분기:150,매출증가율:.25,통과개수:8,판정:'통과',...Object.fromEntries(Array.from({length:8},(_,i)=>['c'+(i+1),true]))};
function render(market='KR',value=row,setupRows=[]){return renderToStaticMarkup(React.createElement(Table,{rows:[value],selected:value,market,onSelect:()=>{},setupRows,setupStamp:'2026-10-22',setupStatus:'success',sortKey:'종합점수',ascending:false,onSort:()=>{}}));}
test('restores judgment fields with original units, condition labels, and actual phase',()=>{const html=render('KR',row,[{code:'123456',state:'setup',nOk:5,nCk:5,stay:2}]);for(const label of ['업종','편입','52주 최고가','피벗 · 이격률','추세 단계','거래대금','거래량 ×','거래량 5일','자금흐름 U/D','수급','EPS 성장','매출 성장','8개 조건'])assert.ok(html.includes(label),label);for(const label of ['흑자전환','동반','셋업','필수 5/5','추세 초기','0.65','1.5','백만원','12,345','67,890'])assert.ok(html.includes(label),label);assert.equal((html.match(/aria-label="\d\. .*?: 충족"/g)||[]).length,8);assert.doesNotMatch(html,/99900|99,900/);assert.match(html,/role="region"/);});
test('US uses average dollar liquidity rather than unavailable foreign institutional flows',()=>{const html=render('US',{...row,코드:'TEST'});assert.match(html,/20일 평균 거래대금/);assert.match(html,/백만달러/);assert.doesNotMatch(html,/동반|외국인 12,345/);});
test('missing conditions and quotes stay unavailable instead of becoming failures or zero',()=>{const html=render('KR',{코드:'EMPTY',종목명:'미제공'});assert.equal((html.match(/: 자료 없음/g)||[]).length,16);assert.doesNotMatch(html,/: 미충족|>0%<|>0<\/td>/);assert.match(html,/—/);});
test('loss and net-income proxy disclosures survive the table redesign',()=>{const html=render('US',{...row,EPS증가율:null,EPS상태:'적자축소',EPS출처:'순이익'});assert.match(html,/적자축소/);assert.match(html,/순이익 증가율/);});

test('production pipe-delimited trends and Korean 52-week field render actual data',()=>{const html=render();assert.match(html,/최근 30거래일 주가 추이/);assert.match(html,/최근 5거래일 거래량/);assert.match(html,/>120</);assert.match(html,/-16.67%/);});

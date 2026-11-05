const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {QueryClient,QueryClientProvider}=require('@tanstack/react-query');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,name.slice(2)):name,parent,...rest);};
require.extensions['.tsx']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
require.extensions['.ts']=require.extensions['.tsx'];
require.extensions['.css']=module=>{module.exports={__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};};
const Journal=require('../components/fincept/trading/JournalDesk.tsx').default;
const Watch=require('../components/fincept/trading/WatchDesk.tsx').default;
const Screening=require('../components/fincept/trading/ScreeningDesk.tsx').default;
const Setup=require('../components/fincept/trading/SetupDesk.tsx').default;
function client(data){const q=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});q.setQueryData(['workspace-account'],{signedIn:!!data});q.setQueryData(['trading','journal'],data);return q;}
function render(Component,q){return renderToStaticMarkup(React.createElement(QueryClientProvider,{client:q},React.createElement(Component,{onStock:()=>{}})));}
const saved={ok:true,data:{cash:5000,holdings:[{name:'보유 테스트',code:'005930',market:'국내',qty:10,avg:100,price:120,why:'기존 매수 이유'}],log:[],watchlist:[{코드:'005930',종목명:'한국 관심 종목',메모:'기존 메모'},{코드:'AAPL',종목명:'미국 관심 종목'}],mind:{'2026-10-22':{plan:'기존 계획'}},bet:{R:.0125},customPreserved:{value:1}}};
test('native journal reads existing account holdings and computes actual valuation',()=>{const html=render(Journal,client(saved));assert.match(html,/보유 테스트/);assert.match(html,/1,200/);assert.match(html,/200/);assert.doesNotMatch(html,/<iframe/);assert.equal(saved.data.customPreserved.value,1);});
test('missing quotes remain unavailable rather than becoming cost-based valuations',()=>{const data=structuredClone(saved);data.data.holdings[0].price=null;const html=render(Journal,client(data));assert.match(html,/평가액/);assert.match(html,/—/);assert.doesNotMatch(html,/>1,000<\/strong>/);});
test('personal pages require login without rendering another account data',()=>{for(const Page of [Journal,Watch]){const html=render(Page,client(null));assert.match(html,/로그인/);assert.doesNotMatch(html,/보유 테스트|한국 관심 종목|<iframe/);}});
test('native watchlist separates KR and US codes while retaining stored notes',()=>{const q=client(saved);q.setQueryData(['trading','screen','KR'],{cols:['코드','현재가','등락률','종합점수','판정'],rows:[['005930',100,.02,80,'통과']]});const html=render(Watch,q);assert.match(html,/한국 관심 종목/);assert.match(html,/기존 메모/);assert.doesNotMatch(html,/미국 관심 종목|<iframe/);});
test('screening decodes compact snapshots into native stock rows',()=>{const q=client(null);q.setQueryData(['trading','screen','KR'],{ok:true,stamp:'test',cols:['코드','종목명','판정','현재가','등락률','종합점수','RS','통과개수'],rows:[['005930','스크리닝 테스트','통과',100,.02,80,90,8]]});const html=render(Screening,q);assert.match(html,/스크리닝 테스트/);assert.match(html,/\+2%/);assert.doesNotMatch(html,/<iframe/);});
test('setup renders saved predicates and scores without legacy frames',()=>{const q=client(null);q.setQueryData(['trading','setup','KR'],{ok:true,total:1,stamp:'test',rows:[{code:'005930',name:'셋업 테스트',sector:'반도체',state:'setup',type:'VCP',price:100,chg:.02,mix:80,pivot:101,stop:95,gap:-.01,stopDist:.05,nOk:1,nCk:1,checks:[['가격 조건',true,'충족',true]]}]});const html=render(Setup,q);assert.match(html,/셋업 테스트/);assert.match(html,/가격 조건/);assert.match(html,/VCP/);assert.doesNotMatch(html,/<iframe/);});

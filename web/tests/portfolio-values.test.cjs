const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../components/fincept/PortfolioDesk.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleObject = {exports:{}};
new Function('require','module','exports',compiled)(name => name === './data' ? {valid:n=>typeof n==='number'&&Number.isFinite(n)} : name.endsWith('.css') ? {} : require(name), moduleObject, moduleObject.exports);
const {validPortfolioLot,portfolioValues,portfolioHistory}=moduleObject.exports;
const lot = (changes={}) => ({id:'1',symbol:'IBM',name:'IBM',quantity:2,averageCost:100,acquiredOn:'2026-10-01',createdAt:'2026-10-01T12:00:00Z',updatedAt:'2026-10-01T12:00:00Z',...changes});
const asset = (changes={}) => ({symbol:'IBM',name:'IBM',currency:'USD',price:120,change:3,asOf:'2026-10-20',status:'delayed',history:[],...changes});

test('empty holdings have zero value and no invented return or risk',()=>{
 const result=portfolioValues([],new Map());
 assert.equal(result.value,0); assert.equal(result.pnl,null); assert.equal(result.dayPnl,null); assert.equal(result.largestWeight,null);
 assert.deepEqual(portfolioHistory([],new Map()),[]);
});
test('multiple acquisition lots aggregate quantity, actual value and cost',()=>{
 const result=portfolioValues([lot(),lot({id:'2',quantity:1,averageCost:80})],new Map([['IBM',asset()]]));
 assert.equal(result.value,360); assert.equal(result.cost,280); assert.equal(result.pnl,80); assert.equal(result.dayPnl,9);
 assert.equal(result.holdings.length,1); assert.equal(result.holdings[0].quantity,3); assert.equal(result.largestWeight,100);
});
test('missing price or a different currency does not become zero or a partial total',()=>{
 for(const missing of [asset({price:null}),asset({currency:'KRW'}),asset({status:'unavailable'})]){
  const result=portfolioValues([lot(),lot({id:'2',symbol:'XYZ'})],new Map([['IBM',asset()],['XYZ',missing]]));
  assert.equal(result.value,null); assert.equal(result.pnl,null); assert.equal(result.dayPnl,null); assert.equal(result.largestWeight,null); assert.equal(result.knownValue,240);
 }
});
test('day P&L requires a common observed day and a full prior-day position',()=>{
 const assets=new Map([['IBM',asset()],['XYZ',asset({asOf:'2026-10-19'})]]);
 assert.equal(portfolioValues([lot(),lot({id:'2',symbol:'XYZ'})],assets).dayPnl,null);
 assert.equal(portfolioValues([lot({acquiredOn:'2026-10-20'})],assets).dayPnl,null);
 assert.equal(portfolioValues([lot()],new Map([['IBM',asset({status:'stale'})]])).dayPnl,null);
});
test('history honors acquisition dates and exact completed observations without forward fill',()=>{
 const assets=new Map([
  ['IBM',asset({history:[{time:'2026-10-01',value:105,isComplete:true},{time:'2026-10-02',value:110,isComplete:true},{time:'2026-10-03',value:115,isComplete:true},{time:'2026-10-04',value:120,isComplete:false}]})],
  ['XYZ',asset({history:[{time:'2026-10-01',value:50,isComplete:true},{time:'2026-10-02',value:60,isComplete:true}]})],
 ]);
 assert.deepEqual(portfolioHistory([lot(),lot({id:'2',symbol:'XYZ',quantity:1,averageCost:55,acquiredOn:'2026-10-02'})],assets),[
  {time:'2026-10-01',value:210,cost:200,pnl:10},
  {time:'2026-10-02',value:280,cost:255,pnl:25},
 ]);
});
test('incomplete current daily bars and missing series produce no invented curve',()=>{
 assert.deepEqual(portfolioHistory([lot()],new Map()),[]);
 assert.deepEqual(portfolioHistory([lot()],new Map([['IBM',asset({history:[{time:'2026-10-20',value:120}]})]])),[]);
 const history=portfolioHistory([lot()],new Map([['IBM',asset({history:[{time:'2026-10-19',value:119},{time:'2026-10-20',value:120,isComplete:true}]})]]));
 assert.equal(history.length,2); assert.equal(history[1].value,240);
});
test('lot validation rejects non-finite, zero, negative and invalid calendar inputs',()=>{
 assert.equal(validPortfolioLot(lot({symbol:'BRK.B',quantity:.5})),true);
 for(const invalid of [{quantity:0},{quantity:-1},{quantity:Infinity},{quantity:NaN},{averageCost:0},{averageCost:1e308,quantity:1e308},{acquiredOn:'2026-02-30'},{symbol:'<script>'}])assert.equal(validPortfolioLot(lot(invalid)),false);
});


test('Korean codes retain leading zeroes and KRW holdings use native prices and completed history',()=>{
 const position=lot({symbol:'005930',quantity:3,averageCost:60000});
 assert.equal(validPortfolioLot(position),true);
 assert.equal(validPortfolioLot(lot({symbol:'0099K0'})),true);
 const quote=asset({symbol:'005930',currency:'KRW',price:70000,change:1000,history:[{time:'2026-10-01',value:65000,isComplete:true},{time:'2026-10-02',value:70000,isComplete:true}]});
 const assets=new Map([['005930',quote]]),result=portfolioValues([position],assets);
 assert.equal(result.value,210000);assert.equal(result.cost,180000);assert.equal(result.pnl,30000);assert.equal(result.dayPnl,3000);
 assert.equal(portfolioHistory([position],assets)[1].value,210000);
});
test('mixed KRW and USD positions cannot produce a combined total, allocation or curve',()=>{
 const positions=[lot(),lot({id:'2',symbol:'005930',averageCost:60000})];
 const assets=new Map([['IBM',asset()],['005930',asset({symbol:'005930',currency:'KRW',price:70000})]]);
 for(const currency of ['USD','KRW']){
  const result=portfolioValues(positions,assets,currency);assert.equal(result.value,null);assert.equal(result.largestWeight,null);assert.equal(result.dayPnl,null);
  assert.deepEqual(portfolioHistory(positions,assets,currency),[]);
 }
});

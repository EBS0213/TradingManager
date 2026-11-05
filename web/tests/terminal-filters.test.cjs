const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('components/bloomberg/lib/market-filters.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const context={exports:{}};vm.runInNewContext(code,context);
const {marketFilterSupport,supportedMarketFilters,filterMarketItems}=context.exports;
const off={showMovers:false,showVolatility:false,showRatios:false,showFutures:false};
const data={americas:[{id:'INDEX',pctChange:0.2},{id:'MOVER',pctChange:2}],emea:[],asiaPacific:[]};

test('absent futures, ratios and volatility cannot hide the index feed even if their old state is selected',()=>{
  const requested={...off,showFutures:true,showRatios:true,showVolatility:true};
  const effective=supportedMarketFilters(requested,data);
  assert.equal(filterMarketItems(data.americas,effective).length,2);
  assert.equal(effective.showFutures,false);
  assert.equal(effective.showRatios,false);
  assert.equal(effective.showVolatility,false);
  assert.equal(requested.showFutures,true);
});
test('real supported futures remain a strict filter across regions and watchlists',()=>{
  const mixed={...data,asiaPacific:[{id:'FUTURE',isFuture:true,pctChange:0.1}]};
  const filters=supportedMarketFilters({...off,showFutures:true},mixed);
  assert.equal(filters.showFutures,true);
  assert.equal(filterMarketItems(mixed.americas,filters).length,0);
  assert.equal(filterMarketItems(mixed.asiaPacific,filters)[0].id,'FUTURE');
});
test('legitimate zero matches are not silently replaced with all rows',()=>{
  const filters=supportedMarketFilters({...off,showMovers:true},data);
  assert.equal(filterMarketItems([data.americas[0]],filters).length,0);
  assert.equal(filterMarketItems(data.americas,filters)[0].id,'MOVER');
  assert.equal(filterMarketItems([],filters).length,0);
});
test('missing and non-finite fields are not capabilities, while actual zero remains supported',()=>{
  const absent={americas:[{peRatio:null,volatility:NaN,pctChange:null,isFuture:false}]};
  assert.equal(marketFilterSupport(absent).ratios,false);
  assert.equal(marketFilterSupport(absent).volatility,false);
  assert.equal(marketFilterSupport(absent).movers,false);
  const zero={americas:[{peRatio:0,volatility:0,pctChange:0}]};
  assert.equal(marketFilterSupport(zero).ratios,true);
  assert.equal(marketFilterSupport(zero).volatility,true);
  assert.equal(filterMarketItems(zero.americas,{...off,showRatios:true}).length,1);
  assert.equal(filterMarketItems(zero.americas,{...off,showVolatility:true}).length,0);
});
test('combined supported filters keep only matching observations',()=>{
  const items=[{id:'both',isFuture:true,pctChange:-2},{id:'quiet',isFuture:true,pctChange:0},{id:'missing',pctChange:NaN}];
  const filters=supportedMarketFilters({...off,showMovers:true,showFutures:true},{americas:items});
  const rows=filterMarketItems(items,filters);
  assert.equal(rows.length,1);assert.equal(rows[0].id,'both');
});

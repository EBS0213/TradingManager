const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,p);
const {setupChartLevels}=require('../lib/setup-chart.ts');
test('setup uses the screening pivot and stop with an exact 5% buy ceiling',()=>{
 const levels=setupChartLevels({pivot:58500,stop:55500});assert.deepEqual(levels.map(r=>[r.id,r.price]),[['setupTop',61425],['setupStop',55500]]);assert.ok(levels.every(r=>r.includeInScale));
});
test('missing and invalid setup prices do not create misleading chart bands',()=>{
 assert.deepEqual(setupChartLevels(),[]);assert.deepEqual(setupChartLevels({pivot:NaN}),[]);assert.deepEqual(setupChartLevels({pivot:0}),[]);assert.equal(setupChartLevels({pivot:100,stop:110}).length,1);
});

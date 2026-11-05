import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {simulateTrade} from '../public/training/trading.js';
import {addMonths} from '../public/training/engine.js';
import {validateCompleted,koreaDay} from '../lib/training/validation.mjs';
const cases=JSON.parse(fs.readFileSync(new URL('../public/training/data/cases.json',import.meta.url)));
const stocks=Object.fromEntries([...new Set(cases.map(c=>c.stockKey??c.symbol))].map(s=>[s,JSON.parse(fs.readFileSync(new URL(`../public/training/data/${s}.json`,import.meta.url)))]));
const settings={stopPct:7,trailingPct:null,sellMode:'short',capital:10000};
const order=cases.slice(0,10).map(c=>c.id),records=Object.fromEntries(order.map(id=>[id,{choice:'buy',selected:{returnPct:99999}}]));
const fixture=()=>({version:2,id:'test',settings,order,records,delays:{},pending:null});
test('server ignores forged profits and rejects incomplete or modified ranked runs',()=>{
 const s=fixture(),run={ordering:JSON.stringify(order),settings:JSON.stringify(settings)};
 const result=validateCompleted(s,cases,stocks,run);assert.ok(result.returnPct<99999);assert.equal(Object.keys(result.payload.records).length,10);
 assert.throws(()=>validateCompleted({...s,pending:{choice:'buy'}},cases,stocks,run));
 assert.throws(()=>validateCompleted({...s,order:[...order].reverse()},cases,stocks,run));
 assert.throws(()=>validateCompleted({...s,delays:{[order[0]]:6}},cases,stocks,run));
 assert.throws(()=>validateCompleted({...s,settings:{...settings,stopPct:1}},cases,stocks,run));
});
test('guest quota day resets at Korean midnight',()=>{
 assert.equal(koreaDay(new Date('2026-10-13T14:59:59Z')),'2026-10-13');
 assert.equal(koreaDay(new Date('2026-10-13T15:00:00Z')),'2026-10-14');
});

test('server preserves and validates per-round risk change history',()=>{
 const s=fixture(),c=cases[0],run={ordering:JSON.stringify(order),settings:JSON.stringify(settings)};
 s.riskChanges={[c.id]:[{after:c.cut,stopPct:2,trailingPct:5,trailingSellPct:50},{after:c.cut+1,stopPct:10,trailingPct:null}]};
 const result=validateCompleted(s,cases,stocks,run);assert.deepEqual(result.payload.riskChanges,s.riskChanges);assert.ok(Number.isFinite(result.returnPct));
 for(const after of [c.cut-1,c.end,1.5])assert.throws(()=>validateCompleted({...s,riskChanges:{[c.id]:[{after,stopPct:7,trailingPct:null}]}},cases,stocks,run));
 assert.throws(()=>validateCompleted({...s,riskChanges:{[c.id]:[{after:c.cut,stopPct:7,trailingPct:5,trailingSellPct:101}]}},cases,stocks,run));
 assert.throws(()=>validateCompleted({...s,riskChanges:{[c.id]:[{after:c.cut,stopPct:0,trailingPct:null}]}},cases,stocks,run));
});

test('server evaluates each requested horizon and rejects incomplete price windows',()=>{
 for(const horizonMonths of [3,6,9,12]){
  const eligible=cases.filter(c=>stocks[c.stockKey??c.symbol].rows.at(-1)[0]>=addMonths(stocks[c.stockKey??c.symbol].rows[c.cut][0],12)).slice(0,10);
  const order=eligible.map(c=>c.id),s={...fixture(),settings:{...settings,horizonMonths},order,records:Object.fromEntries(order.map(id=>[id,{choice:'sell'}]))};
  const result=validateCompleted(s,cases,stocks);assert.equal(result.returnPct,0);assert.ok(Object.values(result.payload.records).every(r=>r.horizonMonths===horizonMonths&&r.sessions>horizonMonths*18));
 }
});

test('server rejects a horizon extending beyond available data',()=>{
 const c=cases.find(c=>stocks[c.stockKey??c.symbol].rows.at(-1)[0]<addMonths(stocks[c.stockKey??c.symbol].rows[c.cut][0],12));assert.ok(c);
 const order=[c.id,...cases.filter(x=>x.id!==c.id).slice(0,9).map(x=>x.id)];
 assert.throws(()=>validateCompleted({...fixture(),settings:{...settings,horizonMonths:12},order,records:Object.fromEntries(order.map(id=>[id,{choice:'sell'}]))},cases,stocks));
});

test('server verifies remainder decisions and recomputes actual sale proceeds',()=>{
 const settings={stopPct:null,trailingPct:5,trailingSellPct:50,sellMode:'cash',capital:10000};
 const c=cases.find(c=>{const t=simulateTrade(stocks[c.stockKey??c.symbol].rows,c.cut,c.end,'buy',settings);return t.fills.length&&t.fills[0].exitIndex<c.end;});assert.ok(c);
 const rows=stocks[c.stockKey??c.symbol].rows,t=simulateTrade(rows,c.cut,c.end,'buy',settings),after=t.fills[0].exitIndex,order=[c.id,...cases.filter(x=>x.id!==c.id).slice(0,9).map(x=>x.id)],remainingActions={[c.id]:{action:'sell',after}};
 const s={...fixture(),settings,order,remainingActions,records:Object.fromEntries(order.map(id=>[id,{choice:'buy'}]))};
 const result=validateCompleted(s,cases,stocks);assert.deepEqual(result.payload.remainingActions,remainingActions);assert.equal(result.payload.records[c.id].selected.returnPct,simulateTrade(rows,c.cut,after,'buy',settings).returnPct);assert.equal(result.payload.records[c.id].selected.remainingFraction,0);
 assert.throws(()=>validateCompleted({...s,remainingActions:{[c.id]:{action:'sell',after:c.cut}}},cases,stocks));
});

test('WAIT allows half of the session and uses the deferred entry price',()=>{
 const s={...fixture(),delays:{[order[0]]:5}},result=validateCompleted(s,cases,stocks),c=cases.find(c=>c.id===order[0]);assert.equal(result.payload.records[c.id].waits,5);assert.equal(result.payload.records[c.id].entry,stocks[c.stockKey??c.symbol].rows[c.cut+50][4]);
 assert.throws(()=>validateCompleted({...s,delays:{[order[0]]:3,[order[1]]:3}},cases,stocks));
});

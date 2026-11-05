import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {selectCases} from '../lib/training/selection.mjs';
import {addMonths} from '../public/training/engine.js';
const read=p=>JSON.parse(fs.readFileSync(`public/training/data/${p}.json`));
const cases=read('cases'),universe=read('universe');
test('each universe contains 150 companies and union counts overlap once',()=>{
 for(const list of Object.values(universe.lists)){assert.equal(list.length,150);assert.equal(new Set(list.map(c=>c.companyKey)).size,150);assert.ok(list.every((c,i)=>!i||list[i-1].marketCapUSD>=c.marketCapUSD));}
 const keys=new Set(Object.values(universe.lists).flat().map(c=>c.companyKey));assert.equal(universe.companies.length,keys.size);assert.equal(new Set(universe.companies.map(c=>c.companyKey)).size,keys.size);
});
test('new cases span 2018–2026, obey selected universe and contemporaneous price floor',()=>{
 const active=cases.filter(c=>c.stockKey),symbols=new Set(universe.companies.map(c=>c.symbol)),cache=new Map();
 for(let year=2018;year<=2026;year++)assert.ok(active.some(c=>c.date.startsWith(String(year))),String(year));
 for(const c of active){assert.ok(symbols.has(c.symbol));if(!cache.has(c.stockKey))cache.set(c.stockKey,read(c.stockKey));const d=cache.get(c.stockKey);assert.equal(d.rows[c.cut][0],c.date);assert.ok(d.nominalClose.slice(c.cut,c.cut+51).every(p=>p>=5));assert.ok(c.lastDate>=addMonths(c.waitDate,3));}
});
test('all horizons choose ten distinct companies and exclude prior questions',()=>{
 for(const months of [3,6,9,12])for(let i=0;i<10;i++){
  const first=selectCases(cases,{months}),next=selectCases(cases,{months,exclude:first}),selected=next.map(id=>cases.find(c=>c.id===id));
  assert.equal(next.length,10);assert.ok(next.every(id=>!first.includes(id)));assert.equal(new Set(selected.map(c=>c.symbol)).size,10);assert.ok(selected.every(c=>c.lastDate>=addMonths(c.waitDate,months)));assert.ok(new Set(selected.map(c=>c.date.slice(0,4))).size>=7);
 }
});

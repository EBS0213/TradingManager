import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reviewRound} from '../public/training/review.js';
import {endIndex,addMonths} from '../public/training/engine.js';
import {evaluateRound,DEFAULT_SETTINGS} from '../public/training/trading.js';
const cases=JSON.parse(fs.readFileSync('public/training/data/cases.json'));
const load=c=>JSON.parse(fs.readFileSync(`public/training/data/${c.stockKey||c.symbol}.json`)).rows;
test('all case types receive a measured review only after a result exists',()=>{
 for(const kind of new Set(cases.map(c=>c.kind))){const c=cases.find(c=>c.kind===kind),rows=load(c),end=endIndex(rows,c.cut,3),result=evaluateRound(rows,c.cut,end,'buy',DEFAULT_SETTINGS);const review=reviewRound(rows,c.cut,kind,result);assert.equal(review.sections.length,4);assert.equal(review.checks.length,7);assert.ok(!JSON.stringify(review).match(/NaN|Infinity|undefined/));assert.equal(reviewRound(rows,c.cut,kind,null),null);}
});
test('future edits cannot change decision-date setup diagnosis',()=>{
 const c=cases[0],rows=load(c),end=endIndex(rows,c.cut,3),r=evaluateRound(rows,c.cut,end,'buy',DEFAULT_SETTINGS);
 const original=reviewRound(rows,c.cut,c.kind,r);const changed=rows.map((row,i)=>i>c.cut?[row[0],1,99999,1,50000,99999]:row);
 assert.deepEqual(reviewRound(changed,c.cut,c.kind,r),original);
});
test('WAIT recalculates evidence at the actual decision day and PASS reviews cash',()=>{
 const c=cases[0],rows=load(c),cut=c.cut+50,end=endIndex(rows,cut,3),r=evaluateRound(rows,cut,end,'sell',DEFAULT_SETTINGS),review=reviewRound(rows,cut,c.kind,r);
 assert.equal(review.date,rows[cut][0]);assert.match(review.sections[2].text,/현금을 유지/);assert.notDeepEqual(review.checks,reviewRound(rows,c.cut,c.kind,r).checks);
});
test('3/6/9/12 months stop at calendar boundary, including WAIT and month ends',()=>{
 for(const c of cases.filter((_,i)=>i%40===0)){const rows=load(c);for(const wait of [0,10,50])for(const months of [3,6,9,12]){const cut=c.cut+wait,end=endIndex(rows,cut,months),limit=addMonths(rows[cut][0],months);assert.ok(rows[end][0]<=limit);if(end+1<rows.length)assert.ok(rows[end+1][0]>limit);if(months===3)assert.ok(end-cut<70);}}
 assert.equal(addMonths('2024-11-30',3),'2025-02-28');assert.equal(addMonths('2023-11-30',3),'2024-02-29');
});

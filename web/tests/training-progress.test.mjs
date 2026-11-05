import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateCompleted,validateProgress} from '../lib/training/validation.mjs';
const cases=JSON.parse(fs.readFileSync('public/training/data/cases.json'));
const order=cases.slice(0,10).map(c=>c.id);
const stocks=Object.fromEntries([...new Set(cases.slice(0,10).map(c=>c.stockKey??c.symbol))].map(key=>[key,JSON.parse(fs.readFileSync(`public/training/data/${key}.json`))]));
const settings={stopPct:7,trailingPct:null,trailingSellPct:100,sellMode:'cash',capital:10000,horizonMonths:3};
const session=()=>({version:2,id:'run',runId:'run',settings:{...settings},order,records:{},delays:{},pending:null});
const run={owner:'user',settings:JSON.stringify(settings),ordering:JSON.stringify(order)};
test('unfinished training can be saved and resumed without qualifying as a completed leaderboard entry',()=>{
 const s=session(),c=cases[0];s.pending={id:c.id,choice:'buy',reveal:c.cut+2};
 const result=validateProgress(s,cases,stocks,run);
 assert.deepEqual(result.payload.pending,s.pending);assert.equal(result.completed,0);assert.equal(result.payload.owner,'user');
 assert.throws(()=>validateCompleted(s,cases,stocks,run),/완료된/);
});
test('saved progress recalculates reported results instead of trusting client scores',()=>{
 const s=session();s.records[order[0]]={choice:'buy',correct:true,selected:{returnPct:999999}};
 const result=validateProgress(s,cases,stocks,run);
 assert.equal(result.completed,1);assert.notEqual(result.payload.records[order[0]].selected.returnPct,999999);
 assert.equal(result.payload.pending,null);
});
test('progress rejects invalid resume positions, out-of-order results and altered run settings',()=>{
 const s=session();s.pending={id:order[1],choice:'buy',reveal:cases[1].cut};
 assert.throws(()=>validateProgress(s,cases,stocks,run),/진행 중인 문제/);
 s.pending={id:order[0],choice:'buy',reveal:cases[0].cut-1};
 assert.throws(()=>validateProgress(s,cases,stocks,run),/진행 중인 문제/);
 s.pending=null;s.records[order[1]]={choice:'sell'};
 assert.throws(()=>validateProgress(s,cases,stocks,run),/진행 순서/);
 s.records={};s.settings.horizonMonths=6;
 assert.throws(()=>validateProgress(s,cases,stocks,run),/세션 정보/);
});

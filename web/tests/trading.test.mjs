import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {simulateTrade,evaluateRound,portfolio,validateSettings,winStats,waitLimit} from '../public/training/trading.js';
import {addMonths} from '../public/training/engine.js';
import {findSetups} from '../public/training/setups.js';
const settings={stopPct:7,trailingPct:null,sellMode:'short',capital:10000};
const rows=[['2024-01-01',100,102,99,100,1],['2024-01-02',100,103,90,95,1],['2024-04-01',110,122,108,120,1]];
test('direction stays correct even when stop loses money',()=>{const r=evaluateRound(rows,0,2,'buy',settings);assert.equal(r.score,2);assert.equal(r.selected.returnPct,-7.000000000000001);assert.equal(r.selected.exit,93);assert.equal(r.buy.exitIndex,1);});
test('no stop, PASS cash and gap execution',()=>{const no={...settings,stopPct:null};assert.equal(simulateTrade(rows,0,2,'buy',no).returnPct,20);assert.equal(simulateTrade(rows,0,2,'sell',no).returnPct,0);assert.equal(simulateTrade(rows,0,2,'sell',{...no,sellMode:'cash'}).returnPct,0);const gap=structuredClone(rows);gap[1][1]=85;gap[1][3]=80;assert.equal(simulateTrade(gap,0,2,'buy',settings).exit,85);gap[1][1]=115;gap[1][2]=120;assert.equal(simulateTrade(gap,0,2,'sell',settings).exit,100);});
test('trailing uses prior highs and never unknown intraday ordering',()=>{const r=[rows[0],['2024-01-02',100,120,95,115,1],['2024-01-03',110,115,106,109,1]];const result=simulateTrade(r,0,2,'buy',{...settings,stopPct:null,trailingPct:10});assert.equal(result.exitIndex,2);assert.equal(result.exit,108);assert.match(result.reason,/트레일링/);});
test('10 equal allocations, remaining cash and settings validation',()=>{const r={a:{selected:{returnPct:20}},b:{selected:{returnPct:-10}}};assert.deepEqual(portfolio(r,settings),{allocation:1000,profit:100,balance:10100,returnPct:1,sumPct:10,completed:2});assert.equal(validateSettings({...settings,stopPct:-1}),false);});
test('all pattern candidates reproduce with future removed',()=>{const cases=JSON.parse(fs.readFileSync('public/training/data/cases.json'));for(const c of cases){const r=JSON.parse(fs.readFileSync(`public/training/data/${c.stockKey??c.symbol}.json`)).rows;const s=findSetups(r,c.cut)[c.kind];assert.ok(s,c.id);assert.deepEqual(s,findSetups(r.slice(0,c.cut+1),c.cut)[c.kind]);assert.deepEqual(c.setup,s);if(c.kind==='vcp')assert.ok(s.legs.at(-1).depth<s.legs[0].depth);}});

test('all cases retain five WAIT advances and a full new 3-month window',()=>{for(const c of JSON.parse(fs.readFileSync('public/training/data/cases.json'))){const {rows}=JSON.parse(fs.readFileSync(`public/training/data/${c.stockKey??c.symbol}.json`));assert.ok(rows.at(-1)[0]>=addMonths(rows[c.cut+50][0],3),c.id);}});

test('risk changes apply only after the revealed candle and cannot undo a fill',()=>{
 const rows=[['2020-01-01',100,100,100,100],['2020-01-02',100,110,95,105],['2020-01-03',108,109,97,100],['2020-01-04',100,101,99,100]];
 const base={stopPct:7,trailingPct:null,sellMode:'short',capital:10000};
 const fixed=simulateTrade(rows,0,3,'buy',{...base,changes:[{after:1,stopPct:2,trailingPct:null}]});assert.equal(fixed.exitIndex,2);assert.equal(fixed.exit,98);
 const trail=simulateTrade(rows,0,3,'buy',{...base,changes:[{after:1,stopPct:null,trailingPct:5}]});assert.equal(trail.exitIndex,2);assert.equal(trail.exit,104.5);
 const filled=simulateTrade(rows,0,3,'buy',{...base,stopPct:2,changes:[{after:1,stopPct:null,trailingPct:null}]});assert.equal(filled.exitIndex,1);assert.equal(filled.exit,98);
});

test('partial profitable trailing exit combines sale proceeds and remaining market value once',()=>{
 const r=[['a',100,100,100,100],['b',100,120,99,118],['c',115,116,107,110],['d',110,135,109,130]];
 const risk={...settings,stopPct:null,trailingPct:10,trailingSellPct:50};
 const t=simulateTrade(r,0,3,'buy',risk);assert.equal(t.fills.length,1);assert.equal(t.fills[0].exit,108);assert.equal(t.fills[0].fraction,.5);assert.equal(t.realizedValue,54);assert.equal(t.marketValue,65);assert.equal(t.returnPct,19);assert.equal(t.remainingFraction,.5);
 const live=simulateTrade(r,0,2,'buy',risk);assert.equal(live.totalValue,109);assert.equal(live.returnPct,9);
 const all=simulateTrade(r,0,3,'buy',{...risk,trailingSellPct:100});assert.equal(all.remainingFraction,0);assert.equal(all.returnPct,8);
 const untouched=simulateTrade(r,0,1,'buy',risk);assert.equal(untouched.fills.length,0);assert.equal(untouched.totalValue,118);assert.equal(untouched.returnPct,18);
 const noRepeat=simulateTrade([...r,['e',115,116,105,110]],0,4,'buy',risk);assert.equal(noRepeat.fills.length,1);assert.equal(noRepeat.remainingFraction,.5);
});
test('trailing cannot sell at a loss, fixed stop can close the remaining shares',()=>{
 const r=[['a',100,100,100,100],['b',100,120,95,118],['c',90,115,88,110],['d',110,112,105,108]];
 const risk={...settings,stopPct:null,trailingPct:10,trailingSellPct:25};
 assert.equal(simulateTrade(r,0,2,'buy',risk).fills.length,0);
 const stop=simulateTrade(r,0,3,'buy',{...risk,stopPct:7});assert.equal(stop.remainingFraction,0);assert.equal(stop.fills[0].exit,90);assert.match(stop.reason,/고정 손절/);
 r[2]=['c',115,116,90,100];const mixed=simulateTrade(r,0,3,'buy',{...risk,stopPct:7});assert.equal(mixed.fills.length,2);assert.equal(mixed.fills[0].fraction,.25);assert.equal(mixed.fills[1].fraction,.75);assert.equal(mixed.totalValue,108*.25+93*.75);
 const low=[r[0],['b',100,105,90,95]];assert.equal(simulateTrade(low,0,1,'buy',risk).fills.length,0);
 for(const trailingSellPct of [0,101,NaN])assert.equal(validateSettings({...risk,trailingSellPct}),false);
});

test('win rate excludes PASS and counts only profitable BUY positions',()=>{
 assert.deepEqual(winStats({a:{choice:'buy',selected:{returnPct:5}},b:{choice:'buy',selected:{returnPct:-2}},c:{choice:'sell',selected:{returnPct:0}}}),{wins:1,trades:2,rate:50});
 assert.equal(winStats({a:{choice:'sell',selected:{returnPct:0}}}).rate,null);
 for(const horizonMonths of [3,6,9,12])assert.equal(validateSettings({...settings,horizonMonths}),true);
 assert.equal(validateSettings({...settings,horizonMonths:5}),false);
});

test('holding or selling the remainder determines the actual combined return',()=>{
 const r=[['a',100,100,100,100],['b',100,120,99,118],['c',115,116,107,110],['d',110,135,109,130]],risk={...settings,stopPct:null,trailingPct:10,trailingSellPct:50};
 const hold=simulateTrade(r,0,3,'buy',{...risk,remainingAction:{action:'hold',after:2}});assert.equal(hold.returnPct,19);assert.equal(hold.remainingFraction,.5);
 const sell=simulateTrade(r,0,3,'buy',{...risk,remainingAction:{action:'sell',after:2}});assert.equal(sell.returnPct,9);assert.equal(sell.remainingFraction,0);assert.equal(sell.fills[1].exit,110);assert.equal(sell.fills[1].reason,'잔량 직접 매도');assert.equal(sell.marketValue,0);
 assert.equal(simulateTrade(r,0,1,'buy',{...risk,remainingAction:{action:'sell',after:2}}).fills.length,0);
});

test("WAIT budget scales with half the problem count",()=>{assert.equal(waitLimit(10),5);assert.equal(waitLimit(20),10);assert.equal(waitLimit(7),3);});

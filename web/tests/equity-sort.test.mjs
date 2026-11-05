import test from 'node:test';
import assert from 'node:assert/strict';
import {equityComparator} from '../lib/terminal/equity-sort.mjs';
import {marketRows} from '../lib/terminal/equities-data.mjs';
test('market cap and turnover sorts place missing values last before pagination',()=>{
 const rows=[{symbol:'MISSING',marketCap:null},{symbol:'SMALL',marketCap:10,turnover:900},{symbol:'LARGE',marketCap:100,turnover:30},{symbol:'ZERO',marketCap:0,turnover:0}];
 assert.deepEqual([...rows].sort(equityComparator('marketCap')).map(r=>r.symbol),['LARGE','SMALL','ZERO','MISSING']);
 assert.deepEqual([...rows].sort(equityComparator('turnover')).slice(0,2).map(r=>r.symbol),['SMALL','LARGE']);
});
test('US turnover is explicitly a close-times-volume estimate, missing volumes stay null',()=>{
 const rows=marketRows({day:'2026-10-22',rows:[{sym:'A',c:20,v:100},{sym:'B',c:10,v:null}]},null);
 assert.equal(rows[0].turnover,2000);assert.equal(rows[0].turnoverBasis,'close-times-volume');assert.equal(rows[1].turnover,null);
});

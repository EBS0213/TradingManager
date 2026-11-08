import test from 'node:test'
import assert from 'node:assert/strict'
import {economyDashboardGroup,filterEconomyDashboard,groupEconomyDashboard,economyChangeUnit} from '../components/economy/dashboard.mjs'
const row=(id,name,category='macro',extra={})=>({id,name,category,country:'USA',status:'available',value:0,asOf:'2026-11-06',source:{name:'Source'},...extra})
test('dashboard classifies legacy macro oil and mortgage series by actual instrument',()=>{
 assert.equal(economyDashboardGroup(row('FRED:us_market:WTI 유가','WTI 유가')).category,'commodities')
 assert.equal(economyDashboardGroup(row('FRED:us_house:30년 모기지 금리','30년 모기지 금리')).category,'rates')
 assert.equal(economyDashboardGroup(row('FRED:GDP','GDP')).id,'growth')
 assert.equal(economyDashboardGroup(row('FRED:M1SL','M1')).id,'money')
 assert.equal(economyDashboardGroup(row('ECOS:M2','M2(평잔)')).id,'money')
 assert.equal(economyDashboardGroup(row('BLS_CPI_YOY','미국 소비자물가 상승률')).id,'prices')
 assert.equal(economyDashboardGroup(row('BLS_CES0000000001','미국 비농업 고용')).id,'employment')
 assert.equal(economyDashboardGroup(row('UST:10Y_2Y','10년 − 2년','rates')).id,'spreads')
})
test('category, subgroup, country, status and search filters intersect without mutating data',()=>{
 const data=[row('a','국채 10년','rates'),row('b','국채 3년','rates',{country:'KOR'}),row('c','국채 2년','rates',{status:'stale'}),row('d','소비자물가')]
 const copy=structuredClone(data)
 assert.deepEqual(filterEconomyDashboard(data,{categories:['rates'],group:'treasury',country:'USA',status:'available',search:'국채'}).map(r=>r.id),['a'])
 assert.deepEqual(data,copy)
 assert.equal(filterEconomyDashboard(data,{categories:[]}).length,0)
})
test('every indicator including null, zero and unfamiliar names appears exactly once by default',()=>{
 const data=[row('a','신규지표'),row('b','금 근월물','commodities'),row('c','통화','macro',{value:null,status:'unavailable'})]
 const groups=groupEconomyDashboard(filterEconomyDashboard(data))
 assert.equal(groups.reduce((sum,g)=>sum+g.items.length,0),3)
 assert.ok(groups.flatMap(g=>g.items).some(r=>r.value===0))
 assert.ok(groups.flatMap(g=>g.items).some(r=>r.value===null))
})
test('percent level differences use percentage points; absolute units are preserved',()=>{
 assert.equal(economyChangeUnit('% (전년동월비)'),'%p')
 assert.equal(economyChangeUnit('KRW/USD'),'KRW/USD')
 assert.equal(economyChangeUnit('천 명'),'천 명')
})

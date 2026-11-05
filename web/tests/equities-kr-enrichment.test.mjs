import test from 'node:test'
import assert from 'node:assert/strict'
import {naverFinancials,dartFinancials,dartShares,enrichKoreanDetails} from '../lib/terminal/equities-kr-enrichment-data.mjs'
const finance={itemCode:'005930',financeInfo:{itemCode:'005930',trTitleList:[{key:'202506',title:'2025.06.',isConsensus:'N'},{key:'202606',title:'2026.06.',isConsensus:'N'},{key:'202609',title:'2026.09.',isConsensus:'Y'}],rowList:[{title:'매출액',columns:{202506:{value:'100'},202606:{value:'120'},202609:{value:'999'}}},{title:'EPS',columns:{202506:{value:'10'},202606:{value:'12'}}},{title:'영업이익률',columns:{202606:{value:'-3.2'}}},{title:'ROE',columns:{202606:{value:'5.5'}}}]},corporationSummary:{comment1:'회사 개요'}}
test('Naver financials exclude forecasts, preserve negative ratios and convert 100 million KRW units',()=>{
 const data=naverFinancials(finance,'005930');assert.equal(data.periodEnd,'2026-06-30');assert.equal(data.revenue,12000000000);assert.equal(data.quarters.length,2);assert(Math.abs(data.revenueGrowthPercent-20)<1e-8);assert.equal(data.operatingMarginPercent,-3.2);assert.equal(data.eps,12);assert.equal(naverFinancials(finance,'000660'),null)
})
const row=(extra={})=>({bsns_year:'2026',reprt_code:'11012',currency:'KRW',sj_div:'IS',account_id:'ifrs-full_Revenue',thstrm_amount:'12,000',frmtrm_q_amount:'10,000',thstrm_add_amount:'90,000',rcept_no:'20260814000001',...extra})
test('DART uses standalone three-month earnings, exact filing period and KRW accounts',()=>{
 const rows=[row(),row({account_id:'dart_OperatingIncomeLoss',thstrm_amount:'-1,200'}),row({account_id:'ifrs-full_ProfitLoss',thstrm_amount:'600'}),row({currency:'USD',thstrm_amount:'999999'})];
 const data=dartFinancials(rows,{year:2026,report:'11012',fs:'CFS'});assert.equal(data.revenue,12000);assert.equal(data.operatingMarginPercent,-10);assert.equal(data.netMarginPercent,5);assert.equal(dartFinancials(rows,{year:2025,report:'11012',fs:'CFS'}),null);assert.equal(dartFinancials(rows,{year:2026,report:'11011',fs:'CFS'}),null)
})
test('DART shares distinguish common and preferred shares; ambiguous totals are rejected',()=>{
 const common={se:'보통주',istc_totqy:'1,000',isu_stock_totqy:'900000',tesstk_co:'10',distb_stock_co:'990'},preferred={se:'우선주',istc_totqy:'100'};const body={status:'000',list:[common,preferred]};
 assert.equal(dartShares(body).sharesOutstanding,1000);assert.equal(dartShares(body,true).sharesOutstanding,100);assert.equal(dartShares({status:'000',list:[common,common]}),null);assert.equal(dartShares({status:'013'}),null)
})
test('enrichment preserves market valuations and labels observed financials and filing sources',()=>{
 const item={symbol:'005930',kind:'stock',profile:{},fundamentals:{per:10,pbr:2,source:{name:'Naver'}}};const result=enrichKoreanDetails(item,{quarter:finance,shares:{sharesOutstanding:1000},dart:{revenue:12100000000,revenuePrior:null,revenueGrowthPercent:null,fs:'CFS',source:{name:'DART',url:'https://dart.fss.or.kr/'}}});
 assert.equal(result.fundamentals.revenue,12100000000);assert.equal(result.fundamentals.per,10);assert.equal(result.fundamentals.eps,12);assert.equal(result.fundamentals.financialPeriod,'2026.06. 분기');assert.equal(result.profile.sharesOutstanding,1000);assert.equal(result.profile.description,'회사 개요');assert.equal(result.fundamentals.financialBasis,'연결')
 assert.equal(enrichKoreanDetails({...item,kind:'etf'},{quarter:finance}).fundamentals.revenue,undefined)
})

test('filing loader uses the DART company settlement-month field and falls back to separate statements',async()=>{
 const {readFile}=await import('node:fs/promises'),{default:vm}=await import('node:vm');
 const source=(await readFile(new URL('../lib/terminal/equities-kr-enrichment.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace('export async function','async function');
 const calls=[],context={naverFinancials,dartFinancials,dartShares,process:{env:{DART_KEY:'test-only',DATABASE_URL:'test-only'}},getSql:async()=>async()=>[{corp:'00126380'}],cachedEconomy:async(_key,_ttl,loader)=>loader(),setTimeout,clearTimeout,AbortSignal,URLSearchParams,
 fetch:async(url)=>{const u=new URL(url);calls.push(u);let body={status:'000'};if(u.pathname.endsWith('/company.json'))body.acc_mt='12';else if(u.pathname.endsWith('/stockTotqySttus.json'))body.list=[{se:'보통주',istc_totqy:'1,000'}];else body=u.searchParams.get('fs_div')==='CFS'?{status:'013'}:{status:'000',list:[row()]};return {ok:true,json:async()=>body}}};
 vm.createContext(context);vm.runInContext(source,context);const result=await context.koreanFilingDetails('005930',finance,false,AbortSignal.timeout(10000));assert.equal(result.shares.sharesOutstanding,1000);assert.equal(result.dart.fs,'OFS');assert.equal(calls.filter(u=>u.pathname.endsWith('/fnlttSinglAcntAll.json')).length,2)
});

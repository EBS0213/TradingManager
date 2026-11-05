const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');const fs=require('node:fs');
const base=process.argv[2]||'http://localhost:3152',fixture=process.argv[3];
(async()=>{
 const data=fixture?JSON.parse(fs.readFileSync(fixture,'utf8')):await (await fetch(`${base}/api/terminal/equities?symbol=AAPL&market=US`)).json();
 const {item}=data;assert.equal(item.symbol,'AAPL');assert.equal(item.yahooStatus,'available');assert(item.fundamentals.per>0);assert(item.profile.floatShares>0);assert(item.consensus.mean>0);assert.equal(item.trailingFinancials.currency,'USD');
 const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const p=await b.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
 await p.route('**/api/terminal/equities?*',async route=>{const u=new URL(route.request().url());if(u.searchParams.has('symbol'))return fixture?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)}):route.continue();return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[item],total:1,matched:1,page:1,pageSize:50,status:'delayed',source:item.source})});});
 await p.goto(`${base}/#terminal/equities`,{waitUntil:'domcontentloaded'});
 await p.getByRole('heading',{name:item.name,exact:true}).waitFor({timeout:45000});
 const panel=title=>p.locator('section').filter({has:p.getByRole('heading',{name:title,exact:true})});
 assert((await panel('가치평가').innerText()).includes('Yahoo Finance'));
 assert((await panel('수익성').innerText()).includes('TTM'));
 assert((await panel('분석가 목표가').innerText()).includes('조회'));
 await p.screenshot({path:'/private/tmp/tm26-yahoo-overview.png',fullPage:true});
 await p.getByRole('tab',{name:'재무',exact:true}).click();await p.getByRole('heading',{name:'최근 12개월 실적',exact:true}).waitFor();
 assert((await panel('최근 12개월 실적').innerText()).includes('보고 통화 USD'));
 await p.screenshot({path:'/private/tmp/tm26-yahoo-financials.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({base,fixture:!!fixture,symbol:item.symbol,per:item.fundamentals.per,floatShares:item.profile.floatShares,targets:item.consensus.count,checks:['valuation','profitability period','targets retrieval time','TTM reported currency','no runtime errors']}));
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

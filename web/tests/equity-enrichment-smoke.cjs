// Uses a fresh guest browser and actual detail API; only the universe list is
// constrained to one real security to avoid downloading thousands of rows in QA.
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');const fs=require('node:fs');
const base=process.argv[2]||'http://localhost:3150';
(async()=>{
 const response=await fetch(`${base}/api/terminal/equities?symbol=032580`);assert(response.ok);const {item}=await response.json();assert.equal(item.symbol,'032580');assert(item.fundamentals.revenue>0);assert(Number.isFinite(item.fundamentals.netMarginPercent));assert(item.fundamentals.financialPeriod);
 const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const p=await b.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.route('**/api/terminal/equities?*',async route=>{const url=new URL(route.request().url());if(url.searchParams.has('symbol'))return route.continue();const rows=url.searchParams.get('market')==='KR'?[item]:[];return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:rows,total:rows.length,matched:rows.length,page:1,pageSize:50,status:'delayed',source:item.source})});});
  await p.goto(`${base}/#terminal/equities`,{waitUntil:'domcontentloaded'});await p.getByLabel('조회 시장').selectOption('KR');await p.getByRole('heading',{name:'피델릭스',exact:true}).waitFor({timeout:45000});
  const profitability=p.locator('section').filter({has:p.getByRole('heading',{name:'수익성',exact:true})});const body=await profitability.innerText();assert(/\d[.,\d]*%/.test(body));assert(body.includes('2026.06.'));
  const recent=p.locator('section').filter({has:p.getByRole('heading',{name:'최근 실적',exact:true})});assert((await recent.innerText()).includes('2026.06.'));
  fs.mkdirSync('/private/tmp/tm26-portfolio-qa',{recursive:true});await p.screenshot({path:'/private/tmp/tm26-portfolio-qa/enriched-company.png',fullPage:true});
  await p.getByRole('tab',{name:'재무',exact:true}).click();await p.getByRole('heading',{name:'분기 실적',exact:true}).waitFor();const table=p.locator('table').filter({has:p.locator('caption').filter({hasText:'저장 분기별 실적'})});assert(!(await table.innerText()).includes('2026.09.'));assert((await p.locator('main').innerText()).includes('영업이익'));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({base,symbol:item.symbol,revenue:item.fundamentals.revenue,period:item.fundamentals.financialPeriod,financialSource:item.fundamentals.source?.name,shares:item.profile?.sharesOutstanding,checks:['actual detail API reaches Naver financials','profitability and fiscal period render','quarter table excludes forecasts','no runtime errors']}));
 }finally{await b.close()}
})().catch(error=>{console.error(error);process.exitCode=1});

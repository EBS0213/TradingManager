const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');

(async()=>{
 const base=process.env.TM26_URL;assert.equal(new URL(base).hostname,'127.0.0.1');
 assert.ok(new URL(process.env.DATABASE_URL).searchParams.get('options')?.includes('release_smoke_'),'isolated DB required');
 const key=process.env.SCREENER_KEY;
 async function json(route,init={}){const r=await fetch(base+route,{...init,headers:{'x-screener-key':key,...init.headers}});assert.equal(r.status,200,route);return r.json()}
 await json('/api/screener/job',{method:'POST'});
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.route('**/api/terminal/equities?**',r=>r.fulfill({json:{ok:true,item:{history:[]}}}));
  await page.route('**/api/setup?**',r=>r.fulfill({json:{ok:true,rows:[]}}));
  await page.goto(base+'/#trading/dash',{waitUntil:'domcontentloaded'});
  await page.getByRole('region',{name:'스크리닝 전체 판단 항목'}).locator('tbody tr').first().waitFor({timeout:60000});
  const button=page.getByRole('button',{name:'새로고침',exact:true});
  const requested=page.waitForResponse(r=>r.url().includes('/api/screener/refresh?market=KR')&&r.request().method()==='POST');
  await button.click();const response=await requested;assert.equal(response.status(),200);
  const result=await response.json();assert.ok(result.job);
  const claim=await json('/api/screener/job');assert.equal(claim.job,result.job);assert.equal(claim.market,'KR');
  const before=(await json('/api/screener/latest?market=KR')).stamp;
  // Run the real worker's queue/finish HTTP functions. External collection is a
  // deterministic fixture; production subprocess commands have separate tests.
  const fixture=path.join(process.cwd(),'tests','screener-refresh-fixture.py');
  fs.writeFileSync(fixture,`import os,sys,json\nsys.path.insert(0,os.path.abspath('../screener/tools'))\nimport agent\nrows=[{'코드':'005930','종목명':'새로고침 검증 종목','현재가':100,'RS':99,'종합점수':99,'판정':'통과'}]\npayload=json.dumps({'market':'KR','stamp':'2099-01-01 00:00 새로고침 검증','source':'isolated-test','result':rows}).encode()\nagent.api('/api/screener/upload',method='POST',data=payload)\nagent.finish_job(${JSON.stringify(result.job)},'KR',True)\n`);
  const worker=spawnSync('python3',[fixture],{cwd:process.cwd(),env:{...process.env,SITE_URL:base},encoding:'utf8'});
  fs.unlinkSync(fixture);assert.equal(worker.status,0,worker.stderr);
  await page.getByText('2099-01-01 00:00 새로고침 검증',{exact:true}).waitFor({timeout:20000});
  assert.notEqual((await json('/api/screener/latest?market=KR')).stamp,before);
  assert.equal((await json('/api/screener/status')).jobs.KR.status,'done');
  await page.getByRole('button',{name:'미국',exact:true}).click();
  const usRequest=page.waitForResponse(r=>r.url().includes('/api/screener/refresh?market=US')&&r.request().method()==='POST');
  await button.click();const us=(await (await usRequest).json()).job;
  assert.equal((await json('/api/screener/job')).market,'US');
  await json('/api/screener/job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job:us,market:'US',status:'failed',error:'검증용 수집 실패'})});
  await page.getByText('검증용 수집 실패',{exact:true}).waitFor({timeout:20000});
  assert.equal((await json('/api/screener/status')).jobs.KR.status,'done');
  await page.screenshot({path:'/private/tmp/tradingmanager-refresh-verified.png'});
  console.log(JSON.stringify({browserClick:'POST refresh',queue:'claimed KR/US separately',worker:'real upload/finish HTTP functions',result:'DB and UI updated',failure:'displayed',externalCollection:'fixture; subprocess commands unit tested'}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

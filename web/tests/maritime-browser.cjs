const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
(async()=>{
 const {freightRows,normalizeVessel}=await import('../lib/maritime/data.mjs');const now=Date.now();
 const vessels=[normalizeVessel({mmsi:'123456789',name:'TEST FIXTURE CARGO',lat:35,lon:129,type:70,asOf:new Date(now).toISOString(),speed:12,track:[{lat:34.9,lon:128.8,asOf:new Date(now-60000).toISOString()},{lat:35,lon:129,asOf:new Date(now).toISOString()}]}),normalizeVessel({mmsi:'223456789',name:'TEST FIXTURE TANKER',lat:34,lon:128,type:80,asOf:new Date(now).toISOString()})];
 const freight=freightRows([{code:'BDI',value:1100,previousValue:1000,asOf:new Date(now).toISOString(),previousAsOf:new Date(now-86400000).toISOString(),frequency:'daily',source:{name:'TEST ONLY',url:'https://example.com'}}]);
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/terminal/maritime',r=>r.fulfill({json:{ok:true,status:'observed',vessels,freight,note:''}}));
 await page.goto('http://localhost:3037/#terminal/maritime',{waitUntil:'domcontentloaded'});
 await page.getByLabel('선박 검색').waitFor();await page.locator('.leaflet-container').waitFor();
 await page.locator('aside button').filter({hasText:'TEST FIXTURE CARGO'}).click();await page.getByRole('heading',{name:'TEST FIXTURE CARGO'}).waitFor();
 assert.equal(await page.getByText('+10%',{exact:true}).count(),1);
 await page.getByLabel('선박 종류',{exact:true}).selectOption('tanker');assert.equal(await page.locator('.leaflet-marker-icon').count(),1);
 await page.getByLabel('선박 검색').fill('not-present');assert.equal(await page.locator('.leaflet-marker-icon').count(),0);
 await page.getByLabel('선박 검색').fill('');await page.getByLabel('선박 종류',{exact:true}).selectOption('all');
 await page.getByRole('button',{name:'컨테이너',exact:true}).click();assert.equal(await page.locator('tbody tr').count(),4);
 await page.getByRole('button',{name:'전체',exact:true}).click();await page.getByLabel('해역 선택').selectOption('korea');
 await page.screenshot({path:'/private/tmp/tm26-maritime-fixture-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/private/tmp/tm26-maritime-fixture-mobile.png',fullPage:true});
 await page.unroute('**/api/terminal/maritime');await page.route('**/api/terminal/maritime',r=>r.fulfill({json:{ok:true,status:'key_required',vessels:[],freight:freightRows([]),note:''}}));
 await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.getByRole('status').filter({hasText:'AIS 데이터 미연결'}).first().waitFor();
 assert.equal(await page.locator('.leaflet-marker-icon').count(),0);assert.equal(await page.locator('tbody tr').count(),10);
 await page.setViewportSize({width:1500,height:1100});await page.screenshot({path:'/private/tmp/tm26-maritime-empty-desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: map/list selection, filters, freight calculation, mobile, missing-data state; no JS errors. Synthetic data restricted to browser interception.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)})

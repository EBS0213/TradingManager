// Read-only UI QA. Local /api/board GET requests use actual public production responses.
// No fixtures, user credentials, mutations, or calls API interception.
const {chromium,request}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.argv[2]||'http://localhost:3126',production='http://127.0.0.1:8766';
const artifacts='/private/tmp/tm26-research-workspace-qa';fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
 const api=await request.newContext({extraHTTPHeaders:{Accept:'application/json'}});
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.setDefaultTimeout(30000);const errors=[],observations={},network=[],checks=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/board**',async route=>{
  const incoming=route.request(),url=new URL(incoming.url());
  if(incoming.method()!=='GET'||!/^\/api\/board(?:\/\d+)?$/.test(url.pathname))return route.continue();
  const response=await api.get(`${production}${url.pathname}${url.search}`,{timeout:45000});
  network.push({url:url.pathname+url.search,status:response.status(),publicSource:production});
  await route.fulfill({status:response.status(),contentType:'application/json',body:await response.body()});
 });
 const check=(name,result)=>{assert(result,name);checks.push(name);console.log('PASS',name)};
 const waitBody=async()=>{await page.locator('section[aria-label="리서치 본문"] h1').waitFor();const frame=page.locator('iframe[title$=" 본문"]');await frame.waitFor();await frame.contentFrame().locator('body').waitFor();return frame;};
 const inspect=async(label)=>{
  const frame=await waitBody(),sandbox=await frame.getAttribute('sandbox');
  await page.locator('aside[aria-label="리서치 제목 목록"] button[aria-pressed]').first().waitFor();
  check(`${label} scripts and same-origin permissions disabled`,!sandbox.includes('allow-scripts')&&!sandbox.includes('allow-same-origin'));
  observations[label]=await frame.contentFrame().locator('body').evaluate(body=>{
   const style=getComputedStyle(body),cells=[...body.querySelectorAll('th,td')].slice(0,20).map(cell=>({tag:cell.tagName,text:cell.textContent.slice(0,50),color:getComputedStyle(cell).color,background:getComputedStyle(cell).backgroundColor,font:getComputedStyle(cell).fontSize}));
   return {background:style.backgroundColor,color:style.color,font:style.fontSize,bodyLength:body.innerText.length,scripts:body.querySelectorAll('script,iframe,form').length,tables:body.querySelectorAll('table').length,cells};
  });
  check(`${label} active content removed`,observations[label].scripts===0);
  check(`${label} actual body displayed`,observations[label].bodyLength>100);
  check(`${label} dark background`,observations[label].background==='rgb(16, 16, 16)');
  await page.screenshot({path:`${artifacts}/${label}.png`,fullPage:true});
  if(observations[label].tables){
   await frame.contentFrame().locator('table').first().scrollIntoViewIfNeeded();
   await page.screenshot({path:`${artifacts}/${label}-table.png`,fullPage:true});
  }
 };
 try{
  await page.goto(`${base}/#terminal/research`,{waitUntil:'domcontentloaded',timeout:60000});
  await inspect('company-desktop');
  check('company tab selected',await page.getByRole('tab',{name:'기업',exact:true}).getAttribute('aria-selected')==='true');
  const halves=await page.evaluate(()=>{const a=document.querySelector('aside[aria-label="리서치 제목 목록"]').getBoundingClientRect(),b=document.querySelector('section[aria-label="리서치 본문"]').getBoundingClientRect();return {left:a.width,right:b.width}});
  observations.split=halves;check('desktop one-to-one columns',Math.abs(halves.left-halves.right)<2);
  const firstList=await page.locator('aside[aria-label="리서치 제목 목록"] button[aria-pressed]').allTextContents();
  check('list contains titles only',firstList.length>0&&firstList.every(text=>!text.includes('미리보기')&&!text.includes('<!DOCTYPE')));
  check('only one report iframe and no embedded legacy workspace',await page.locator('iframe').count()===1);
  await page.getByRole('tab',{name:'전략',exact:true}).click();await inspect('strategy-desktop');
  const strategyTitle=await page.locator('section[aria-label="리서치 본문"] h1').innerText();
  check('strategy document loaded',strategyTitle.includes('시황'));
  await page.locator('aside[aria-label="리서치 제목 목록"] button[aria-pressed]').first().click();
  await page.waitForURL(url=>/#terminal\/research\/\d+$/.test(url.hash));const deepLink=page.url();
  await page.reload({waitUntil:'domcontentloaded'});await waitBody();
  check('deep link restores selected title',await page.locator('section[aria-label="리서치 본문"] h1').innerText()===strategyTitle);
  check('deep link restores strategy tab',await page.getByRole('tab',{name:'전략',exact:true}).getAttribute('aria-selected')==='true');
  observations.deepLink=deepLink;
  await page.setViewportSize({width:390,height:844});await inspect('strategy-mobile');
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  check('mobile document has no page-level horizontal overflow',dimensions.scroll<=dimensions.width+1);
  await page.getByRole('tab',{name:'기업',exact:true}).click();
  await page.getByLabel('리서치 제목 검색',{exact:true}).fill('LEU');
  await page.waitForResponse(response=>new URL(response.url()).pathname==='/api/board'&&new URL(response.url()).searchParams.get('q')==='LEU');
  await page.locator('aside[aria-label="리서치 제목 목록"] button[aria-pressed]').first().waitFor();
  check('title search reaches actual public API',(await page.locator('aside[aria-label="리서치 제목 목록"]').innerText()).includes('LEU'));
  await inspect('company-mobile');
  await page.getByRole('tab',{name:'컨퍼런스콜',exact:true}).click();
  await page.waitForTimeout(1500);observations.callsStatus=await page.locator('aside[aria-label="리서치 제목 목록"]').innerText();
  await page.screenshot({path:`${artifacts}/calls-current-state.png`,fullPage:true});
  check('no React runtime errors',errors.length===0);
  fs.writeFileSync(`${artifacts}/result.json`,JSON.stringify({checks,observations,errors,network},null,2));
  console.log(JSON.stringify({checks:checks.length,artifacts,callsStatus:observations.callsStatus},null,2));
 }finally{await context.close();await browser.close();await api.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1});

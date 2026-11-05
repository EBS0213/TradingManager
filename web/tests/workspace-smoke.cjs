const { chromium } = require('playwright-core');
const fs=require('node:fs'); const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}); const errors=[]; const checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 const check=(name,value=true)=>{assert(value,name);checks.push(name);console.log('PASS',name)};
 try {
 await page.goto(new URL('/#terminal/analytics',process.env.BASE_URL||process.argv[2]||'http://localhost:3126').href,{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('button',{name:'KOSPI RMI 분석'}).waitFor({timeout:30000});
 check('advanced terminal is accessible',page.url().includes('#terminal/analytics'));
 await page.screenshot({path:'tests/artifacts/terminal-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'NEW',exact:true}).click();
 await page.getByLabel('관심목록 이름').fill('QA KOREA');
 await page.getByRole('checkbox',{name:'KOSPI',exact:true}).check();
 await page.getByRole('button',{name:'SAVE',exact:true}).click();
 await page.getByRole('button',{name:'QA KOREA',exact:true}).waitFor();
 check('watchlist saves and filters',await page.getByRole('button',{name:'NASDAQ RMI 분석'}).count()===0);
 await page.reload();await page.getByRole('button',{name:'KOSPI RMI 분석'}).waitFor();
 check('watchlist persists reload',await page.getByRole('button',{name:'QA KOREA',exact:true}).count()===1);
 await page.getByRole('button',{name:'QA KOREA',exact:true}).click();await page.getByRole('menuitem',{name:'Standard',exact:true}).click();
 const analysisResponse=page.waitForResponse(response=>response.url().endsWith('/api/terminal/ai') && response.request().method()==='POST');
 await page.getByRole('button',{name:'MARKET OVERVIEW',exact:true}).click();
 const analysis=await analysisResponse; const analysisBody=await analysis.json();
 check('local analysis returns facts',analysis.ok() && analysisBody.mode==='local' && analysisBody.response?.length>80);
 for(const view of ['GMOV','GVOL','RMI','NEWS']){
  await page.getByRole('button',{name:view,exact:true}).first().click();
  await page.getByRole('button',{name:'HELP',exact:true}).click();
  await page.getByRole('heading',{name:'Keyboard Shortcuts'}).waitFor();
  await page.getByRole('button',{name:'Close',exact:true}).click(); check(view+' + HELP works');
 }
 const search=page.getByLabel('뉴스 검색');await search.fill('123 금융');await search.press('1');
 check('input shortcuts do not navigate',await search.isVisible());
 await page.getByRole('button',{name:'LIGHT',exact:true}).click();check('light theme',await page.locator('.bloomberg-terminal').getAttribute('data-theme')==='light');
 await page.getByRole('button',{name:'DARK',exact:true}).click();
 await page.getByRole('button',{name:'MKT',exact:true}).click();
 await page.getByRole('button',{name:'KOSPI RMI 분석'}).click();
 await page.getByRole('tab',{name:'TABLE',exact:true}).click();
 check('RMI uses historical data',(await page.locator('body').innerText()).includes('RMI Historical Data'));
 await page.screenshot({path:'tests/artifacts/rmi-desktop.png',fullPage:true});
 await page.locator('.tm-areas').getByRole('button',{name:/트레이딩/}).click();
 const legacy=page.frameLocator('iframe[title="TM26 트레이딩 및 리서치"]');
 await legacy.locator('#hq').waitFor({timeout:30000});
 for(const [label,id] of [['기록','log'],['셋업','setup'],['차트게임','training'],['스크리닝','dash']]){
   await page.getByRole('button',{name:new RegExp('^0[1-4] '+label+'$')}).click();
   await page.waitForTimeout(350);
   check(label+' route',page.url().includes('#trading/'+id));
   if(id!=='dash'){
     await legacy.locator('#page-'+id).waitFor({state:'visible',timeout:15000});
     check(label+' visible',await legacy.locator('#page-'+id).isVisible());
   }
 }
 await page.getByRole('button',{name:/^03 기록$/}).click();await page.waitForTimeout(300);
 await page.screenshot({path:'tests/artifacts/trading-record.png',fullPage:true});
 await page.goBack();await page.waitForTimeout(350);check('browser back',page.url().includes('#trading/dash'));
 await page.locator('.tm-areas').getByRole('button',{name:/터미널/}).click();await page.waitForTimeout(1500);
 check('hidden legacy does not change area',page.url().includes('#terminal/overview'));
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tests/artifacts/terminal-mobile.png',fullPage:true});
 check('mobile page fits',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.locator('.tm-areas').getByRole('button',{name:/트레이딩/}).click();await page.getByRole('button',{name:/^03 기록$/}).click();await page.waitForTimeout(300);
 await page.screenshot({path:'tests/artifacts/trading-mobile.png',fullPage:true});
 check('no uncaught browser errors',errors.length===0);
 } finally {fs.writeFileSync('tests/artifacts/workspace-smoke.json',JSON.stringify({checks,errors,url:page.url()},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

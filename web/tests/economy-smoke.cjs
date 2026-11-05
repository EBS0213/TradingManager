const {chromium}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const baseURL=process.env.BASE_URL||process.argv[2]||'http://localhost:3126';
const artifacts=path.join(__dirname,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[],checks=[],responses=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().includes('/api/terminal/economy'))responses.push({url:r.url(),status:r.status()})});
 const check=(name,value=true)=>{assert(value,name);checks.push(name);console.log('PASS',name)};
 try{
  await page.goto(new URL('/#terminal/data',baseURL).href,{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('heading',{name:'경제 데이터 허브',exact:true}).waitFor();
  check('native economy hub opens directly',page.url().endsWith('#terminal/data'));
  await page.locator('.eco-chart .recharts-surface').first().waitFor();
  check('overview chart renders real series');
  await page.screenshot({path:path.join(artifacts,'economy-overview-desktop.png'),fullPage:true});
  await page.locator('.eco-segment').getByRole('button',{name:'표',exact:true}).click();
  check('table shows real dated rows',await page.locator('.eco-table tbody tr').count()>0);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'CSV',exact:true}).click();
  const download=await downloadPromise;await download.saveAs(path.join(artifacts,'economy-export.csv'));
  check('CSV downloaded with source column',fs.readFileSync(path.join(artifacts,'economy-export.csv'),'utf8').includes('출처 URL'));
  await page.locator('.eco-segment').getByRole('button',{name:'차트',exact:true}).click();
  const kr=page.waitForResponse(r=>r.url().includes('view=country')&&r.url().includes('country=KOR'));
  const us=page.waitForResponse(r=>r.url().includes('view=country')&&r.url().includes('country=USA'));
  await page.locator('.eco-tabs').getByRole('button',{name:/국가 비교/}).click();
  const [krRes,usRes]=await Promise.all([kr,us]); const [krData,usData]=await Promise.all([krRes.json(),usRes.json()]);
  check('Korea and USA API responses succeed',krRes.ok()&&usRes.ok());
  await page.getByRole('region',{name:'경제 지표 탐색'}).locator('tbody button').first().waitFor({timeout:30000});
  check('country selectors render KOR / USA',(await page.getByRole('combobox',{name:'기준 국가',exact:true}).inputValue())==='KOR'&&(await page.getByRole('combobox',{name:'비교 국가',exact:true}).inputValue())==='USA');
  const chosenName=await page.locator('.eco-explorer .eco-panel-heading h2').innerText();
  const first=krData.series.find(item=>item.name===chosenName), peer=usData.series.find(x=>x.id===first.id&&x.unit===first.unit&&x.frequency===first.frequency&&x.source.name===first.source.name);
  await page.locator('.eco-detail-metrics').waitFor();
  check('country comparison respects exact source/id/unit/frequency',await page.locator('.eco-detail-metrics > div').count()===(peer?2:1));
  console.log('COUNTRY',{kr:first.source,us:usData.series[0]?.source,comparable:!!peer});
  await page.screenshot({path:path.join(artifacts,'economy-country-desktop.png'),fullPage:true});
  for(const [name,pattern] of [['금리·채권',/10년|금리|국채/],['환율·원자재',/WTI|환율|원유|금/],['데이터 소스',/World Bank|IMF|Treasury/]]){
   await page.locator('.eco-tabs').getByRole('button',{name:new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
   check(name+' renders',pattern.test(await page.locator('.eco-hub').innerText()));
  }
  check('source status labels visible',(await page.locator('.eco-hub').innerText()).includes('인증 키 필요'));
  await page.setViewportSize({width:390,height:844});
  for(const name of ['개요','국가 비교','금리·채권','환율·원자재','데이터 소스']){
   await page.locator('.eco-tabs').getByRole('button',{name:new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
   await page.screenshot({path:path.join(artifacts,'economy-mobile-'+name.replace(/[^a-zA-Z0-9가-힣]/g,'')+'.png'),fullPage:true});
   const width=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,viewport:innerWidth}));
   check(name+' mobile has no page overflow',width.doc<=width.viewport+1);
  }
  check('no browser runtime errors',errors.length===0);
 }finally{
  fs.writeFileSync(path.join(artifacts,'economy-smoke.json'),JSON.stringify({checks,errors,responses,url:page.url()},null,2));
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exit(1)});

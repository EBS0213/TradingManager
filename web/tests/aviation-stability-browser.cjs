const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let step=0,requests=0;
 if(process.env.TM26_ACCESS_CONFIG){
  const config=JSON.parse(require('node:fs').readFileSync(process.env.TM26_ACCESS_CONFIG,'utf8'));
  const key=Object.entries(config.protectionBypass||{}).find(([,value])=>value.scope==='automation-bypass')?.[0];
  if(!key)throw Error('Existing deployment access unavailable');
  const origin=new URL(process.env.TEST_URL).origin;
  await page.route(origin+'/**',route=>route.continue({headers:{...route.request().headers(),'x-vercel-protection-bypass':key}}));
 }
 const observation=Date.now();const planes=[0,1].map(i=>({id:'abc12'+i,callsign:'CHECK00'+i,registration:'CHECK',aircraft:'A320',lat:35.54+i*.2,lon:129.32+i*.2,asOf:new Date(observation).toISOString(),ground:false,altitude:30000,speed:400,heading:90,verticalRate:0,squawk:'',category:'',source:'fixture',stale:false}));
 await page.route('**/api/terminal/aviation?*',route=>{requests++;if(step===3)return route.fulfill({status:503,json:{error:'offline'}});return route.fulfill({json:{ok:true,status:step===1?'observed':step===2?'empty':'observed',coverage:[],updatedAt:new Date().toISOString(),aircraft:step===0?planes:step===1?[planes[1]]:step===2?[]:planes.map(p=>({...p,asOf:new Date(observation+10000).toISOString(),lon:p.lon+.02}))}})});
 await page.goto((process.env.TEST_URL||'http://localhost:3046')+'/#terminal/aviation');
 const map=page.getByLabel('항공기 위치 지도',{exact:true});await map.waitFor({timeout:60000});
 const count=n=>page.waitForFunction(n=>document.querySelector('[data-aircraft-canvas]')?.dataset.vessels===String(n),n,{timeout:10000});await count(2);await page.waitForTimeout(1200);
 await page.getByRole('button',{name:'CHECK000',exact:true}).click();await count(1);await page.getByRole('heading',{name:'CHECK000',exact:true}).waitFor();
 async function refresh(next){step=next;const old=requests;await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.waitForTimeout(next===3?2200:500);assert.ok(requests>old);await page.getByRole('button',{name:'새로고침',exact:true}).waitFor();}
 await refresh(1);await count(1);assert.equal(await page.locator('[data-aircraft-canvas]').getAttribute('data-drawn'),'1');await page.getByRole('heading',{name:'CHECK000',exact:true}).waitFor();assert.ok((await page.locator('aside').innerText()).includes('이전 관측'));
 await page.getByRole('button',{name:'선택 해제',exact:true}).click();await count(2);
 await refresh(2);await count(2);await refresh(3);await count(2);
 await refresh(4);await count(2);assert.ok(!(await page.getByRole('status').filter({hasText:'최근 관측'}).innerText()).includes('이전 관측'));
 await page.getByRole('button',{name:'CHECK000',exact:true}).click();await count(1);await page.getByRole('button',{name:'닫기',exact:true}).click();await count(2);
 assert.equal(await page.locator('.leaflet-control-zoom').count(),0);
 await page.screenshot({path:process.env.SCREENSHOT_PATH||'/private/tmp/tm26-aircraft-stability-20261105.png'});
 // Age positions without another network response. Expired selection must reveal remaining aircraft.
 await page.clock.install({time:new Date(observation)});await page.clock.fastForward(315000);await count(0);
 assert.deepEqual(errors,[]);
 console.log('PASS: selected aircraft survives observed snapshot omissions, empty/HTTP failure, recovery, expiry without network response; no browser errors');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});

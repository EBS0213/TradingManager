// Isolated synthetic API fixtures: no user browser profile or account data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright-core');
(async () => {
 const out='/private/tmp/tm26-equity-watchlist-qa'; await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await context.newPage(); const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let active=0,maxActive=0;const calls=[];
 const item=(symbol,market)=>({symbol,name:`Fixture ${symbol}`,kind:'stock',currency:market==='KR'?'KRW':'USD',exchange:market,price:123.45,previousClose:120,change:3.45,changePercent:2.875,volume:2500,volumeUnit:'shares',asOf:'2026-10-21',status:'available',history:[],source:{name:'TEST FIXTURE',url:'https://example.test/source'}});
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let body={ok:false};
  if(url.pathname==='/api/terminal/equities'){
   const market=url.searchParams.get('market')||'US';const symbol=url.searchParams.get('symbol');
   if(symbol){active++;maxActive=Math.max(maxActive,active);calls.push({symbol,market});await new Promise(r=>setTimeout(r,100));body={item:item(symbol,market)};active--;}
   else {const symbol=market==='KR'?'005930':url.searchParams.get('kind')==='etf'?'QQQ':'SIRI';body={items:[item(symbol,market)],page:1,pageSize:50,total:1,matched:1,status:'available',source:{name:'TEST FIXTURE',url:'https://example.test/source'}};}
  } else if(url.pathname==='/api/terminal/market-data')body={americas:[],emea:[],asiaPacific:[],status:'available'};
  else if(url.pathname==='/api/terminal/assets')body={items:[],status:'available',errors:[]};
  else if(url.pathname==='/api/terminal/economy')body={series:[],errors:[],status:'available'};
  else if(url.pathname==='/api/terminal/news')body={items:[],status:'available'};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://localhost:3126/#terminal/equities');
 await page.getByRole('button',{name:'SIRI 관심 저장',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('tm26_fincept_watchlist'))),['SIRI']);
 const downloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'현재 페이지 CSV',exact:true}).click();
 const download=await downloadWait;const file=out+'/'+download.suggestedFilename();await download.saveAs(file);const csv=await fs.readFile(file,'utf8');
 for(const expected of ['"Currency"','"Volume unit"','"As of"','"Source URL"','"USD"','"shares"','2026-10-21','https://example.test/source','SIRI'])assert.ok(csv.includes(expected),expected);
 await page.getByRole('combobox',{name:'조회 시장'}).selectOption('KR');await page.getByRole('button',{name:'005930 관심 저장',exact:true}).click();
 await page.screenshot({path:out+'/equity-save.png',fullPage:true});
 await page.goto('http://localhost:3126/#terminal/etfs');
 await page.getByRole('button',{name:'QQQ 관심 저장',exact:true}).click();
 assert.ok((await page.evaluate(()=>JSON.parse(localStorage.getItem('tm26_fincept_watchlist')))).includes('QQQ'));
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:out+'/etf-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:3126/#terminal/watchlist');
 await page.getByRole('button',{name:'SIRI 관심 해제',exact:true}).waitFor();
 await page.waitForFunction(()=>document.body.innerText.includes('Fixture SIRI')&&document.body.innerText.includes('Fixture 005930'));
 assert.ok(calls.some(c=>c.symbol==='SIRI'&&c.market==='US'));assert.ok(calls.some(c=>c.symbol==='005930'&&c.market==='KR'));
 await page.reload();await page.getByRole('button',{name:'SIRI 관심 해제',exact:true}).waitFor();
 await page.screenshot({path:out+'/watchlist.png',fullPage:true});
 await page.getByRole('button',{name:'SIRI 관심 해제',exact:true}).click();
 assert.ok(!(await page.evaluate(()=>JSON.parse(localStorage.getItem('tm26_fincept_watchlist')))).includes('SIRI'));
 await page.evaluate(()=>localStorage.setItem('tm26_fincept_watchlist',JSON.stringify(['SIRI','005930','QQQ','SCHD','VOO','IBM','ORCL','CRM','ADBE','GE'])));
 active=0;maxActive=0;await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.fc-table tbody tr').length===10&&document.body.innerText.includes('Fixture GE'));
 assert.ok(maxActive<=4,`max active ${maxActive}`);assert.ok(maxActive>=2);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/watchlist-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
 assert.deepEqual(errors,[]);const result={passed:true,fixture:'synthetic isolated API fixture',maxConcurrentDetail:maxActive,csv:file,checks:['US save','KR save','ETF save and mobile','CSV units/date/source','arbitrary symbol detail','reload persistence','remove','4-worker cap','mobile overflow','no page errors']};
 await fs.writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await context.close();
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.argv[2]||'http://localhost:3143';
const output='/private/tmp/tm26-future-chart-check';
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000);
 await page.addInitScript(()=>localStorage.setItem('tm26_fincept_watchlist',JSON.stringify(Array.from({length:50},(_,i)=>`TEST ${i+1}`))));
 try{
  await page.goto(`${base}/#terminal/overview`,{waitUntil:'domcontentloaded'});await page.bringToFront();
  const futures=page.locator('.fc-dash-indices .fc-market-futures');
  await futures.locator('tbody th a,tbody th button').first().waitFor();
  assert.deepEqual(await futures.locator('tbody th').allTextContents(),['NQ1!','ES1!','K2I1!','KQI1!','KQI1!']);
  assert.deepEqual(await futures.locator('thead th').allTextContents(),['종목','현재값','등락률']);
  assert.equal(await futures.locator('small,.fc-futures-note').count(),0);
  assert(!/주간|야간|출처|지연|기준 시각|KST|Npay|자동 갱신/.test(await futures.innerText()));
  const values=await futures.locator('tbody td:first-of-type').allTextContents();assert(values.every(v=>v!=='—'));
  assert.equal(await futures.locator('a').count(),0);
  const initialURL=page.url(),chartChecks=[];
  for(const [index,symbol] of ['NQ','ES','K200-F','K150-F','K150-NIGHT'].entries()){
   const responsePromise=page.waitForResponse(res=>{const url=new URL(res.url());return url.pathname==='/api/terminal/futures'&&url.searchParams.get('symbol')===symbol});
   await futures.locator('tbody tr').nth(index).getByRole('button').click();
   const response=await responsePromise;assert.equal(response.status(),200);
   const {item}=await response.json();assert.equal(item.futureSymbol,symbol);assert(item.history.length>1,`No observed history for ${symbol}`);
   const chart=page.locator('.fc-dash-chart');
   await chart.getByRole('heading',{name:item.symbol,exact:true}).waitFor();
   if(symbol==='K150-NIGHT'){
    await chart.getByText('야간 · 1분 관측',{exact:true}).waitFor();
    const cutoff=Date.parse(item.history.at(-1).time)-60*60000;
    const count=item.history.filter(point=>Date.parse(point.time)>=cutoff).length;
    await chart.locator('.fc-chart-readout').getByText(`${count}개 관측`,{exact:true}).waitFor();
   }
   await chart.locator('.fc-chart-plot svg path').waitFor();
   assert((await chart.locator('.fc-chart-plot svg path').getAttribute('d')).length>20);
   assert.equal(await futures.locator('tbody tr').nth(index).getByRole('button').getAttribute('aria-pressed'),'true');
   assert.equal(page.url(),initialURL);assert.equal(page.context().pages().length,1);
   chartChecks.push({symbol,points:item.history.length});
  }
  await page.screenshot({path:`${output}/selected-future.png`,fullPage:true});
  const indexButton=page.locator('.fc-dash-indices > .fc-table-wrap tbody .fc-asset-name').first();
  await indexButton.waitFor();const indexName=await indexButton.innerText();await indexButton.click();
  await page.locator('.fc-dash-chart').getByRole('heading',{name:indexName,exact:true}).waitFor();
  assert.equal(await futures.locator('[aria-pressed="true"]').count(),0);
  const watch=page.getByRole('region',{name:'대시보드 관심 목록',exact:true});
  await watch.locator('tbody tr').nth(49).waitFor({state:'attached'});
  assert.equal(await watch.locator('tbody tr').count(),50);
  assert.equal(await page.locator('.fc-dashboard-pair').first().locator('.fc-dashboard-column').first().locator(':scope > .fc-panel > .fc-panel-head > h2').allTextContents().then(x=>JSON.stringify(x)),JSON.stringify(['글로벌 시장','암호화폐','관심 목록']));
  const metrics=await watch.evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight}));assert(metrics.client>0&&metrics.scroll>metrics.client,JSON.stringify(metrics));
  const columns=page.locator('.fc-dashboard-pair').first().locator('.fc-dashboard-column');
  const left=await columns.nth(0).boundingBox(),center=await columns.nth(1).boundingBox();assert(Math.abs(left.y+left.height-center.y-center.height)<2);
  await watch.evaluate(el=>el.scrollTop=el.scrollHeight);assert(await watch.evaluate(el=>el.scrollTop>0));
  await watch.locator('tbody tr').last().getByRole('button',{name:/관심 해제/}).click();
  assert.equal(await watch.locator('tbody tr').count(),49);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tm26_fincept_watchlist')).length),49);
  await watch.evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:`${output}/desktop.png`,fullPage:true});
  for(const width of [1100,390]){
   await page.setViewportSize({width,height:900});
   await page.waitForTimeout(200);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow ${width}`);
   const size=await watch.boundingBox();assert(size.height<=282&&size.height>100,JSON.stringify(size));
   assert(await watch.evaluate(el=>el.scrollHeight>el.clientHeight));
   await page.screenshot({path:`${output}/${width}.png`,fullPage:true});
  }
  await Promise.all([page.waitForResponse(res=>new URL(res.url()).pathname==='/api/terminal/futures'&&res.status()===200),futures.getByRole('button',{name:'선물 시세 새로고침'}).click()]);
  await page.goto(`${base}/#terminal/market`,{waitUntil:'domcontentloaded'});
  const marketFutures=page.locator('.fc-market-futures');
  await marketFutures.locator('tbody button').first().waitFor();
  await marketFutures.locator('tbody button').first().focus();await page.keyboard.press('Enter');
  await page.locator('.fc-split .fc-instrument').getByRole('heading',{name:'NQ1!',exact:true}).waitFor();
  assert(page.url().endsWith('#terminal/market'));assert.equal(page.context().pages().length,1);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({base,chartChecks,checks:['all five futures open central chart without navigation','regular index selection restores index chart','market page and keyboard selection work','ticker, price and percent only','all five prices available','watchlist below crypto','50 saved rows scroll inside remaining space','column bottoms aligned','star removal persists','tablet and mobile bounded scrolling','manual refresh works'],values,metrics,errors},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

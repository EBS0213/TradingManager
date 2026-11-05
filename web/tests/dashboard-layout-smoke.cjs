const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');const fs=require('node:fs');
const base=process.argv[2]||'http://localhost:3145';const local=new URL(base).hostname==='localhost';
const output='/private/tmp/tm26-content-layout-check';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const results=[];
 try{
  for(const count of [1,50]){
   const page=await browser.newPage({viewport:{width:2048,height:1200}});const errors=[];page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(n=>localStorage.setItem('tm26_fincept_watchlist',JSON.stringify(Array.from({length:n},(_,i)=>`TEST ${i+1}`))),count);
   if(local)await page.route(url=>url.pathname==='/api/brief'&&url.searchParams.get('view')==='dashboard',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,items:[{day:'2026-10-23',slot:'mid',title:'장중 브리핑',text:Array.from({length:120},(_,i)=>`${i+1}. 시장 현황과 주요 지표를 확인하는 긴 브리핑입니다. 내용은 이 박스 안에서 스크롤합니다.`).join('\n')}]})}));
   await page.goto(`${base}/#terminal/overview`,{waitUntil:'domcontentloaded'});await page.bringToFront();
   await page.locator('.fc-market-futures tbody button').first().waitFor();
   await page.locator('.fc-news-wire a').nth(10).waitFor({state:'attached'});
   await page.locator('.fc-dash-stocks tbody tr').nth(9).waitFor({state:'attached'});
   await page.locator('.fc-dashboard-reference-column .fc-economic-list button').first().waitFor();
   await page.locator('.fc-dash-chart .fc-chart-plot svg').waitFor();
   await page.waitForTimeout(750);
   assert.equal(await page.getByRole('heading',{name:'뉴스 와이어',exact:true}).count(),0);
   await page.getByRole('heading',{name:'헤드라인',exact:true}).waitFor();
   for(const width of [2048,1440,1100]){
    await page.setViewportSize({width,height:1100});await page.waitForTimeout(400);
    const layout=await page.locator('.fc-dashboard').evaluate(root=>{
     const box=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}};
     const cols=[...root.querySelectorAll('.fc-dashboard-column')].map(c=>({...box(c),last:box(c.lastElementChild)}));
     const body=root.querySelector('.fc-brief-body'),wire=root.querySelector('.fc-news-wire'),indices=root.querySelector('.fc-dash-indices > .fc-table-wrap');
     const refs=[...root.querySelectorAll('.fc-dashboard-reference-column')].map(c=>{const p=c.lastElementChild;return {panel:box(p),content:box(p.lastElementChild)}});
     const watch=root.querySelector('.fc-dash-watchlist'),table=watch.querySelector('table');
     return {height:root.style.getPropertyValue('--fc-dashboard-height'),cols,refs,brief:body?{client:body.clientHeight,scroll:body.scrollHeight}:null,headline:{client:wire.clientHeight,scroll:wire.scrollHeight},indices:{client:indices.clientHeight,table:indices.querySelector('table').getBoundingClientRect().height},watch:{panel:box(watch),table:table?box(table):null}};
    });
    assert(layout.height,JSON.stringify(layout));
    for(const c of layout.cols)assert(Math.abs(c.bottom-c.last.bottom)<2,`Box does not fill column at ${width}: ${JSON.stringify(layout)}`);
    if(width>1200)assert(Math.max(...layout.cols.map(c=>c.bottom))-Math.min(...layout.cols.map(c=>c.bottom))<2,`Bottoms differ ${width}: ${JSON.stringify(layout)}`);
    else for(const pair of [[0,1],[2,3]])assert(Math.abs(layout.cols[pair[0]].bottom-layout.cols[pair[1]].bottom)<2);
    for(const ref of layout.refs)assert(ref.content.bottom>=ref.panel.bottom-3,`Empty filler below reference content ${JSON.stringify(layout)}`);
    assert(layout.indices.table>=layout.indices.client-2,`Empty filler below indices ${JSON.stringify(layout)}`);
    assert(layout.headline.scroll>layout.headline.client&&layout.headline.client>60,JSON.stringify(layout));
    if(layout.brief)assert(layout.brief.client>30&&layout.brief.scroll>layout.brief.client,JSON.stringify(layout));
    if(count===1&&layout.watch.table)assert(Math.abs(layout.watch.panel.bottom-layout.watch.table.bottom)<4,`Single-item watchlist has filler ${JSON.stringify(layout)}`);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    results.push({count,width,...layout});await page.screenshot({path:`${output}/${count}-${width}.png`,fullPage:true});
   }
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const wire=page.locator('.fc-news-wire');await wire.evaluate(el=>el.scrollTop=el.scrollHeight);assert(await wire.evaluate(el=>el.scrollTop>0));
   const brief=page.locator('.fc-brief-body');if(await brief.count()){await brief.evaluate(el=>el.scrollTop=el.scrollHeight);assert(await brief.evaluate(el=>el.scrollTop>0));}
   assert.equal(errors.length,0,errors.join('\n'));await page.screenshot({path:`${output}/${count}-390.png`,fullPage:true});await page.close();
  }
  fs.writeFileSync(`${output}/result.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(x=>({count:x.count,width:x.width,height:x.height,brief:x.brief,headline:x.headline,watch:x.watch.panel.height})),null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

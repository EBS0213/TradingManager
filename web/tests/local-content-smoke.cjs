const assert=require('node:assert/strict');const {chromium}=require('playwright-core');
(async()=>{
 const base=process.env.TM26_URL;assert.equal(new URL(base).hostname,'127.0.0.1');
 async function get(path){const r=await fetch(base+path);assert.equal(r.status,200,path);return r.json()}
 const reports=await get('/api/board?cat=report'),calls=await get('/api/calls?view=index'),kr=await get('/api/screener/latest?market=KR');
 assert.ok(reports.total>=75);assert.ok(calls.total>=49);assert.ok(kr.result.length>0);
 const first=calls.items[0],q=new URLSearchParams({code:first.code,quarter:first.quarter,lang:'ko'});
 const transcript=await get('/api/calls/transcript?'+q);assert.equal(transcript.status,'available');
 const detail=await get('/api/board/'+reports.posts[0].id);assert.ok(detail.files.length);
 const pdf=await fetch(base+'/api/files/get?id='+detail.files[0].id);assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(base+'/#terminal/research');await page.locator('aside[aria-label="리서치 제목 목록"] button').first().waitFor({timeout:60000});
  await page.screenshot({path:'/private/tmp/tm-restored-reports.png'});
  await page.getByRole('tab',{name:'미국',exact:true}).click();await page.locator('aside[aria-label="리서치 제목 목록"] button').first().waitFor({timeout:30000});
  await page.goto(base+'/#terminal/calls');await page.getByRole('tab',{name:'English',exact:true}).waitFor({timeout:60000});
  await page.screenshot({path:'/private/tmp/tm-restored-calls.png'});
  console.log({reports:reports.total,calls:calls.total,kr:kr.result.length,koreanTranscript:transcript.status,pdf:'valid',ui:'reports and calls visible'});
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

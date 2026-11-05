// Run after npm run build: node --env-file=.env.local tests/local-records-smoke.cjs
// Uses a temporary PostgreSQL schema; never writes the owner's actual records.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const pg=require('pg');
const {chromium}=require('playwright-core');
const schema='tm26_records_test_'+Date.now(),origin='http://127.0.0.1:8767';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
let server,browser,logs='';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function ready(){for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Test server exited: '+logs.slice(-1500));try{if((await fetch(origin+'/api/auth/me')).ok)return;}catch{}await pause(200);}throw Error('Test server startup timed out');}
async function api(path,body,method=body===undefined?'GET':'POST',extra={}){
 const response=await fetch(origin+path,{method,headers:{origin,'content-type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await response.json();assert(response.ok,`${path}: ${response.status} ${data.error||''}`);return data;
}
(async()=>{try{
 await pool.query(`CREATE SCHEMA ${schema}`);
 const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','8767'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',DATABASE_URL:url.href,TM26_LOCAL_ONLY:'1',TM26_LOCAL_TOKEN:'a'.repeat(64),TM26_CHAT_WORKER_TOKEN:'b'.repeat(64)},stdio:['ignore','pipe','pipe']});
 for(const stream of [server.stdout,server.stderr])stream.on('data',d=>{logs=(logs+d).slice(-10000)});
 await ready();
 const account=await api('/api/auth/me');assert.equal(account.local,true);assert.equal(account.signedIn,true);assert.equal(account.admin,true);
 browser=await chromium.launch({...(process.env.TEST_CHROME_PATH?{executablePath:process.env.TEST_CHROME_PATH}:process.platform==='darwin'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{channel:'chrome'}),headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1080}}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#trading/log');
 await page.getByLabel('현금',{exact:true}).waitFor();
 await page.getByLabel('현금',{exact:true}).fill('123456');
 const [cashSave]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/screener/journal')&&r.request().method()==='PUT'),page.getByLabel('현금',{exact:true}).press('Tab')]);assert.equal(cashSave.status(),200);
 await page.getByLabel('오늘의 매매 전략',{exact:true}).fill('로컬 저장 검증 메모');
 const [save]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/screener/journal')&&r.request().method()==='PUT'),page.getByRole('button',{name:'저장',exact:true}).nth(1).click()]);assert.equal(save.status(),200);
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('textarea')[1]?.value==='로컬 저장 검증 메모');
 assert.equal(await page.locator('textarea').nth(1).inputValue(),'로컬 저장 검증 메모');
 assert.equal(await page.getByLabel('현금',{exact:true}).inputValue(),'123456');
 assert.equal((await context.cookies()).some(c=>c.name==='tm_session'),false);
 await Promise.all([
  api('/api/screener/journal',{watchlist:[{코드:'005930',종목명:'검증 종목',메모:'검증',추가일:'2026-11-05'}]},'PUT'),
  api('/api/screener/journal',{holdings:[{code:'005930',name:'검증 보유',market:'KR',qty:1,avg:100,price:100}]},'PUT')
 ]);
 const saved=(await api('/api/screener/journal')).data;
 assert.equal(saved.watchlist.length,1);assert.equal(saved.holdings.length,1);assert.equal(saved.cash,123456);assert.equal(Object.values(saved.mind)[0].plan,'로컬 저장 검증 메모');
 const stored=(await pool.query(`SELECT data FROM ${schema}.screener_user_data`)).rows[0].data;assert.deepEqual(stored,saved);
 assert.equal((await api('/api/screener/watchlist')).watchlist.length,1);
 const training=await api('/api/training/me');assert.equal(training.user.local,true);assert.equal(training.remaining,null);
 const settings={stopPct:7,trailingPct:null,trailingSellPct:100,sellMode:'cash',capital:10000,horizonMonths:3};let run;
 for(let i=0;i<3;i++)run=await api('/api/training/runs',{settings});
 const session={version:2,id:run.id,runId:run.id,settings,order:run.order,records:{},delays:{}};
 await api('/api/training/progress',{session});assert.equal((await api('/api/training/progress')).items.length,1);
 assert.equal((await api('/api/training/progress?id='+run.id)).session.runId,run.id);
 await api('/api/training/sessions');
 const workerHeaders={authorization:'Bearer '+'b'.repeat(64)};
 await api('/api/chat/worker',{action:'heartbeat'},'POST',workerHeaders);
 const chat=await api('/api/chat',{question:'로컬 대화 기록 검증',history:[],page:'#trading/log'});
 const claimed=await api('/api/chat/worker',{action:'claim'},'POST',workerHeaders);assert.equal(claimed.job.id,chat.id);
 await api('/api/chat/worker',{action:'complete',id:chat.id,lease:claimed.job.lease,answer:'격리된 검증 응답'},'POST',workerHeaders);
 const history=await api('/api/chat?history=1');assert.equal(history.authenticated,true);assert.equal(history.jobs[0].answer,'격리된 검증 응답');
await api('/api/board');await api('/api/admin/summary');
 await api('/api/auth/apikey');assert.equal(typeof(await api('/api/auth/apikey',{})).key,'string');
 await api('/api/local/session',{},'POST',{'x-local-launch-token':'a'.repeat(64)});
 assert.deepEqual((await api('/api/screener/journal')).data,saved);
 await api('/api/auth/logout',{});assert.equal((await api('/api/auth/me')).local,true);
 const redirect=await fetch(origin+'/login?next=%2F%23trading%2Flog',{redirect:'manual'});assert.equal(redirect.status,307);assert.equal(new URL(redirect.headers.get('location'),origin).href,origin+'/#trading/log');
 for(const headers of [{host:'evil.example'},{origin:'https://evil.example'},{'sec-fetch-site':'cross-site'}])assert.equal(await new Promise((resolve,reject)=>require('node:http').get(origin+'/api/screener/journal',{headers},r=>{r.resume();resolve(r.statusCode)}).on('error',reject)),403,JSON.stringify(headers));
 await page.goto(origin+'/#terminal/account');await page.getByText('로컬 개인용',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'계정',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'로그아웃',exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: cookie-free UI save/reload, PostgreSQL persistence, concurrent fields, watchlist, training beyond guest quota, saved progress, admin/board/key access, native owner consistency, logout independence, login redirect and origin protection.');
}finally{
 if(browser){for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({path:'../migration/personal-records-update/browser-test.png',fullPage:true}).catch(()=>{});await browser.close();}
 if(server&&server.exitCode===null){const stopped=once(server,'exit');server.kill('SIGTERM');await Promise.race([stopped,pause(5000)]);if(server.exitCode===null)server.kill('SIGKILL');}
 await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();
}})().catch(e=>{console.error(e.stack);process.exitCode=1});

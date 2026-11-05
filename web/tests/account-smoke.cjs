// Synthetic sessions and intercepted account/admin mutations; never writes a real account.
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');const fs=require('node:fs');
const base=process.argv[2]||'http://localhost:3146';const output='/private/tmp/tm26-account-check';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const checks=[];
 async function fixture(role='admin',delay=0,failed=false){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],calls=[];
  page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(error.message));
  const state={signedIn:role!=='guest',admin:role==='admin',nickname:'검증회원',key:null,issued:0,password:'fixture-current',summary:{counts:{total:2,verified:2,pending:0,new7:1,active7:2},users:[{email:'fixture@example.test',nickname:'검증회원',role:'admin',verified:true,created_at:'2026-10-01T00:00:00Z',last_login:'2026-10-23T00:00:00Z'},{email:'member@example.test',role:'user',verified:true}],rate:1400,costs:[{항목:'테스트 서비스',금액:10,통화:'USD',주기:'월',메모:'검증용'},{항목:'연간 테스트',금액:12000,통화:'KRW',주기:'연',메모:''}]}};
  const send=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({ok:status<400,...body})});
  await page.route('**/api/terminal/**',route=>send(route,{items:[],series:[],americas:[],emea:[],asiaPacific:[]}));
  await page.route('**/api/brief**',route=>send(route,{items:[]}));
  await page.route('**/api/auth/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname,method=req.method(),body=req.postDataJSON();calls.push({path,method,body});
   if(path==='/api/auth/me'){
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    if(failed)return send(route,{error:'접속 오류'},503);
    return send(route,{signedIn:state.signedIn,admin:state.admin,email:state.signedIn?'fixture@example.test':undefined,nickname:state.nickname});
   }
   if(path==='/api/auth/logout'){state.signedIn=false;state.admin=false;return send(route,{});}
   if(path==='/api/auth/account'&&method==='PATCH'){
    if('nickname' in body){state.nickname=body.nickname;return send(route,{nickname:body.nickname});}
    assert.equal(body.currentPassword,'fixture-current');assert.equal(body.newPassword,'fixture-updated');state.password=body.newPassword;return send(route,{changed:'password'});
   }
   if(path==='/api/auth/apikey'){
    if(method==='GET')return send(route,{key:state.key,limits:{perMin:30,perDay:2000}});
    if(method==='POST'){
     if(body.password!==state.password)return send(route,{error:'비밀번호가 맞지 않습니다.'},403);
     state.issued++;state.key={hint:'tmk_test…0001',uses:0,created_at:'2026-10-23T00:00:00Z'};
     return send(route,{key:`tmk_fixture_not_a_real_key_${state.issued}`,hint:state.key.hint,limits:{perMin:30,perDay:2000}});
    }
    if(method==='DELETE'){state.key=null;return send(route,{revoked:true});}
   }
   return send(route,{error:'Unexpected intercepted operation'},501);
  });
  await page.route('**/api/admin/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname,method=req.method(),body=req.postDataJSON();calls.push({path,method,body});
   if(!state.admin)return send(route,{error:'관리자만 볼 수 있습니다.'},403);
   if(path==='/api/admin/summary')return send(route,state.summary);
   if(path==='/api/admin/costs'&&method==='PUT'){state.summary={...state.summary,costs:body.items,rate:body.rate};return send(route,{});}
   return send(route,{error:'Unexpected intercepted operation'},501);
  });
  return {page,context,state,calls,errors};
 }
 try{
  const f=await fixture('admin',500);const {page,state,calls}=f;
  await page.goto(`${base}/#terminal/overview`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'계정',exact:true}).click();
  assert(page.url().endsWith('#terminal/account'));assert(!page.url().includes('/login'));
  await page.getByRole('heading',{name:'내 계정',exact:true}).waitFor();
  await page.getByLabel('닉네임',{exact:true}).waitFor();assert.equal(await page.getByLabel('닉네임',{exact:true}).inputValue(),'검증회원');
  checks.push('signed-in account button opens settings without login redirect, including delayed session');
  await page.getByLabel('닉네임',{exact:true}).fill('새이름');await page.getByRole('button',{name:'닉네임 저장'}).click();await page.getByText('닉네임을 저장했습니다.',{exact:true}).waitFor();assert.equal(state.nickname,'새이름');
  await page.getByLabel('현재 비밀번호',{exact:true}).fill('fixture-current');await page.getByLabel('새 비밀번호',{exact:true}).fill('fixture-updated');await page.getByLabel('새 비밀번호 확인',{exact:true}).fill('fixture-mismatch');
  await page.getByRole('button',{name:'비밀번호 변경',exact:true}).click();await page.getByText('새 비밀번호가 서로 다릅니다.',{exact:true}).waitFor();assert(!calls.some(x=>x.body?.newPassword));
  await page.getByLabel('새 비밀번호 확인',{exact:true}).fill('fixture-updated');await page.getByRole('button',{name:'비밀번호 변경',exact:true}).click();await page.getByText('비밀번호를 변경했습니다.',{exact:true}).waitFor();assert.equal(await page.getByLabel('현재 비밀번호',{exact:true}).inputValue(),'');checks.push('nickname and password forms call existing APIs with validation and clear passwords');
  await page.getByLabel('API 키 발급 비밀번호').fill('fixture-updated');await page.getByRole('button',{name:'API 키 발급',exact:true}).click();await page.getByLabel('발급한 API 키',{exact:true}).waitFor();assert.equal(await page.getByLabel('발급한 API 키',{exact:true}).inputValue(),'tmk_fixture_not_a_real_key_1');
  assert.equal(await page.evaluate(()=>Object.values(localStorage).some(value=>value.includes('tmk_fixture'))),false);
  await page.getByLabel('API 키 발급 비밀번호').fill('fixture-updated');await page.getByRole('button',{name:'API 키 다시 발급',exact:true}).click();assert.equal(state.issued,1);await page.getByRole('button',{name:'취소',exact:true}).click();assert.equal(state.issued,1);
  await page.getByRole('button',{name:'API 키 다시 발급',exact:true}).click();await page.getByRole('button',{name:'기존 키 교체'}).click();await page.waitForFunction(()=>document.querySelector('input[aria-label="발급한 API 키"]')?.value.endsWith('_2'));assert.equal(state.issued,2);
  await page.getByRole('button',{name:'API 키 폐기',exact:true}).click();await page.getByRole('button',{name:'폐기 확인'}).click();await page.getByText('API 키를 폐기했습니다.',{exact:true}).waitFor();assert.equal(state.key,null);assert.equal(await page.getByLabel('발급한 API 키',{exact:true}).count(),0);checks.push('API key issue, rotation confirmation, revoke and secret lifetime work');
  assert.equal(await page.getByRole('heading',{name:'회원 탈퇴',exact:true}).count(),0);
  await page.screenshot({path:`${output}/account-desktop.png`,fullPage:true});
  await page.getByRole('button',{name:'관리',exact:true}).click();await page.getByRole('heading',{name:'관리',level:1}).waitFor();await page.getByRole('heading',{name:'회원 목록',exact:true}).waitFor();assert(page.url().endsWith('#terminal/admin'));assert.equal(await page.locator('iframe:visible').count(),0);
  const main=page.getByRole('main');assert(!/한국은행|ECOS|한국 경제지표 일정/.test(await main.innerText()));assert(!calls.some(x=>x.path==='/api/admin/calendar'));
  await page.getByLabel('비용 1 금액').fill('20');await page.getByRole('button',{name:'비용 저장',exact:true}).click();await page.getByText('유지 비용을 저장했습니다.',{exact:true}).waitFor();assert.equal(state.summary.costs[0].금액,20);assert.equal(state.summary.rate,1400);
  await page.getByRole('button',{name:'항목 추가',exact:true}).click();assert.equal(await page.getByLabel('비용 3 항목').count(),1);await page.getByLabel('비용 3 삭제').click();
  await page.getByLabel('회원 검색').fill('member@');assert.equal(await page.locator('table').first().locator('tbody tr').count(),1);await page.getByLabel('회원 검색').clear();
  await page.screenshot({path:`${output}/admin-desktop.png`,fullPage:true});checks.push('admin statistics, user search and cost editing persist; bank/calendar panel removed');
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${output}/admin-mobile.png`,fullPage:true});
  await page.getByRole('button',{name:'계정',exact:true}).click();await page.getByLabel('닉네임',{exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await page.getByLabel('발급한 API 키').count(),0);
  await page.screenshot({path:`${output}/account-mobile.png`,fullPage:true});await page.getByRole('button',{name:'로그아웃',exact:true}).click();await page.getByRole('link',{name:'로그인',exact:true}).waitFor();assert(page.url().endsWith('#terminal/account'));assert.equal(state.signedIn,false);checks.push('logout clears private settings; account and admin layouts fit mobile');assert.equal(f.errors.length,0,f.errors.join('\n'));await f.context.close();
  for(const role of ['user','guest']){
   const f=await fixture(role);await f.page.goto(`${base}/#terminal/account`,{waitUntil:'domcontentloaded'});
   if(role==='user'){await f.page.getByLabel('닉네임',{exact:true}).waitFor();assert.equal(await f.page.getByRole('button',{name:'관리',exact:true}).count(),0);await f.page.getByRole('heading',{name:'회원 탈퇴'}).waitFor();}
   else {const login=f.page.getByRole('link',{name:'로그인',exact:true});await login.waitFor();assert.equal(new URL(await login.getAttribute('href'),base).searchParams.get('next'),'/#terminal/account');}
   await f.page.goto(`${base}/#terminal/admin`,{waitUntil:'domcontentloaded'});if(role==='user')await f.page.getByText('관리자 권한이 필요합니다.',{exact:true}).waitFor();else await f.page.getByRole('link',{name:'로그인',exact:true}).waitFor();assert(!f.calls.some(x=>x.path==='/api/admin/summary'));assert.equal(f.errors.length,0);await f.context.close();
  }
  checks.push('members and guests never receive admin data or controls; guest login returns to account');
  const failed=await fixture('admin',0,true);await failed.page.goto(`${base}/#terminal/account`,{waitUntil:'domcontentloaded'});await failed.page.getByRole('button',{name:'다시 확인',exact:true}).waitFor();assert(!failed.page.url().includes('/login'));assert.equal(await failed.page.getByRole('link',{name:'로그인',exact:true}).count(),0);await failed.context.close();checks.push('session fetch errors do not misclassify a logged-in user as a guest');
  console.log(JSON.stringify({base,checks,realAccountMutations:0},null,2));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});

// Live browser → API → rendered value checks. No fixture data, account access, or trading.
const {chromium}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.argv[2]||'http://localhost:3126',local=new URL(base).hostname==='localhost';
const artifacts=path.join(__dirname,'artifacts',`fincept-expanded-${Date.now()}`);fs.mkdirSync(artifacts,{recursive:true});
const names={overview:'대시보드',market:'글로벌 시장',equities:'주식',etfs:'ETF',portfolio:'포트폴리오',news:'뉴스',commodities:'원자재',research:'리서치',calls:'컨퍼런스콜',calendar:'실적 일정',data:'경제 데이터'};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(30000);
 const checks=[],failures=[],skipped=[],errors=[],observations={};
 page.on('pageerror',e=>errors.push(e.message));
 const check=(name,value=true)=>{assert(value,name);checks.push(name);console.log('PASS',name)};
 const skip=(name,reason)=>{skipped.push({name,reason});console.log('SKIP',name,reason)};
 const api=async url=>{const response=await context.request.get(base+url,{timeout:65000});let body;try{body=await response.json()}catch{}return{status:response.status(),body}};
 const nav=async id=>{await page.goto(`${base}/#terminal/${id}`,{waitUntil:'domcontentloaded'});await page.locator('.fc-content').waitFor();};
 const shot=async name=>page.screenshot({path:path.join(artifacts,name+'.png'),fullPage:true});
 const story=async(name,fn)=>{console.log('STORY',name);try{await fn()}catch(e){failures.push({name,error:e.message});console.error('FAIL',name,e.message);await shot('failure-'+failures.length).catch(()=>{})}};
 try{
  await story('Compact dashboard and legible type',async()=>{
   await nav('overview');await page.locator('.fc-dashboard .fc-panel').first().waitFor();
   check('twelve dashboard panels',await page.locator('.fc-dashboard .fc-panel').count()===12);
   const gaps=await page.locator('.fc-dashboard-column').evaluateAll(cols=>cols.flatMap(col=>[...col.children].slice(1).map((el,i)=>Math.round(el.getBoundingClientRect().top-col.children[i].getBoundingClientRect().bottom))));
   check('independent columns have no dead rows',gaps.length>4&&gaps.every(g=>g>=0&&g<=5));
   const text=await page.locator('.fc-panel-head h2').first().evaluate(el=>({size:parseFloat(getComputedStyle(el).fontSize),smooth:getComputedStyle(el).webkitFontSmoothing}));
   check('panel type is clear and enlarged',text.size>=12&&text.smooth!=='none');
   await delay(9000);await shot('dashboard-desktop');
  });
  await story('KR and US complete equity and ETF monitors',async()=>{
   for(const market of ['KR','US'])for(const kind of ['all','etf']){
    const response=await api(`/api/terminal/equities?market=${market}&kind=${kind}&pageSize=2&sort=symbol`);
    if(local&&market==='US'&&response.status!==200){skip('US paid connection local','production credentials stay on deployment');continue;}
    assert.equal(response.status,200,`${market} ${kind} API`);const data=response.body;
    check(`${market} ${kind} is not a featured-symbol shortlist`,data.total>(kind==='etf'?100:1000)&&data.pages>1&&data.items.length===2);
    const second=await api(`/api/terminal/equities?market=${market}&kind=${kind}&pageSize=2&sort=symbol&page=2`);
    check(`${market} ${kind} pagination changes symbols`,second.body.items[0].symbol!==data.items[0].symbol);
    observations[`${market}-${kind}`]={total:data.total,coverage:data.coverage,asOf:data.asOf};
   }
   await nav('equities');await page.getByLabel('조회 시장',{exact:true}).selectOption('KR');
   await page.getByRole('searchbox',{name:'종목 검색',exact:true}).fill('005930');
   const symbol=page.getByRole('button',{name:'005930',exact:true});await symbol.waitFor({timeout:65000});await symbol.click();
   await page.getByRole('region',{name:'선택 종목 시세'}).getByText('KRW',{exact:true}).waitFor();
   const selected=await api('/api/terminal/equities?market=KR&symbol=005930');assert.equal(selected.status,200);
   check('Samsung preserves leading zero, KRW and actual history',selected.body.item.symbol==='005930'&&selected.body.item.currency==='KRW'&&selected.body.item.history.length>30);
   await page.getByRole('img',{name:/005930 .*가격 차트/}).waitFor({timeout:65000});
   check('Samsung financial chart rendered',await page.getByRole('tab',{name:'개요',exact:true}).getAttribute('aria-selected')==='true');
   await shot('equity-research-desktop');
   await nav('etfs');await page.getByLabel('조회 시장',{exact:true}).selectOption('KR');await page.getByRole('searchbox',{name:'종목 검색',exact:true}).fill('0053M0');
   await page.getByRole('button',{name:'0053M0',exact:true}).waitFor({timeout:65000});
   check('alphanumeric Korean ETF is searchable');await shot('etf-monitor-desktop');
  });
  await story('Expanded commodity sources preserve units',async()=>{
   const response=await api('/api/terminal/economy?view=overview');assert.equal(response.status,200);
   const rows=response.body.series.filter(x=>x.category==='commodities');
   check('ten commodity observations exposed',rows.length>=10);
   const names=rows.map(x=>x.name).join(' ');check('silver copper gas and grains included',/은/.test(names)&&/구리/.test(names)&&/가스/.test(names)&&/옥수수/.test(names)&&/대두/.test(names));
   observations.commodities=rows.map(x=>({name:x.name,unit:x.unit,status:x.status}));
   await nav('commodities');await page.locator('.fc-table tbody tr').nth(9).waitFor();await shot('commodities-desktop');
  });
  await story('News sources, single-line rows and right article reader',async()=>{
   const response=await api('/api/terminal/news');assert.equal(response.status,200);const news=response.body;
   check('six Telegram channels included',new Set(news.items.filter(x=>x.category==='telegram').map(x=>x.channel)).size===6);
   check('global financial channels included',news.items.some(x=>x.source==='Financial Times')&&news.items.some(x=>x.source==='BBC Business'));
   await nav('news');await page.locator('.fc-news-feed button').first().waitFor({timeout:65000});
   const aligned=await page.locator('.fc-news-feed button').first().evaluate(el=>{const publisher=el.querySelector('b').getBoundingClientRect(),title=el.querySelector('span').getBoundingClientRect();return Math.abs(publisher.top-title.top)<2});check('publisher and headline share one line',aligned);
   const article=news.items.find(x=>x.source==='Federal Reserve')||news.items.find(x=>x.source==='The Guardian Business');assert(article);
   await page.getByLabel('뉴스 언론사').selectOption(article.source);const chosen=page.locator('.fc-news-feed button').filter({hasText:article.title}).first();await chosen.click();
   await page.locator('.fc-article h2').filter({hasText:article.title}).waitFor();
   const original=await api('/api/terminal/news/article?url='+encodeURIComponent(article.url));assert.equal(original.status,200);
   check('public article body available in right reader',original.body.status==='available'&&original.body.paragraphs.length>1);
   await page.locator('.fc-article').getByText(original.body.paragraphs[0],{exact:true}).waitFor({timeout:30000});
   check('article original link preserved',await page.getByRole('link',{name:/원문 열기/}).getAttribute('href')===article.url);
   observations.news={count:news.items.length,sources:news.sources,reader:{source:article.source,paragraphs:original.body.paragraphs.length}};await shot('news-desktop');
  });
  await story('Research is native, title-only and equal-width split',async()=>{
   const response=await api('/api/board?cat=report&page=1');
   if(local&&response.status!==200){skip('local public research','local DB is not configured; production test required');return;}
   assert.equal(response.status,200);assert(response.body.posts.length);
   await nav('research');const list=page.getByRole('complementary',{name:'리서치 제목 목록'});await list.locator('button[aria-pressed]').first().waitFor({timeout:65000});
   check('three research tabs',await page.getByRole('tablist',{name:'리서치 유형'}).getByRole('tab').allTextContents().then(x=>x.join(',')==='기업,전략,컨퍼런스콜'));
   const ratio=await page.evaluate(()=>{const a=document.querySelector('[aria-label="리서치 제목 목록"]').getBoundingClientRect(),b=document.querySelector('[aria-label="리서치 본문"]').getBoundingClientRect();return a.width/b.width});check('research panels are 1:1',Math.abs(ratio-1)<.01);
   check('research list shows titles without HTML preview',!(await list.innerText()).includes('<!DOCTYPE')&&await list.locator('button[aria-pressed]').first().innerText()===response.body.posts[0].title);
   await list.locator('button[aria-pressed]').first().click();await page.waitForURL(u=>u.hash===`#terminal/research/${response.body.posts[0].id}`);
   const article=page.getByRole('region',{name:'리서치 본문'});await article.getByRole('heading',{name:response.body.posts[0].title,exact:true}).waitFor();
   check('native research has no legacy controls',await page.locator('.tm-legacy-content:visible').count()===0);
   const frame=article.locator('iframe');await frame.waitFor();check('report active content sandboxed',!(await frame.getAttribute('sandbox')).includes('allow-scripts'));
   await shot('research-desktop');
   await page.getByRole('tab',{name:'전략',exact:true}).click();await list.locator('button[aria-pressed]').first().waitFor();check('strategy tab loads its reports');
   await nav('calls');const calls=await api('/api/calls');assert.equal(calls.status,200);assert(calls.body.items.length);
   await page.getByRole('region',{name:'리서치 본문'}).locator('article').waitFor({timeout:65000});check('calls use research split and saved detail');
   await shot('calls-desktop');
  });
  await story('Trading separation and responsive layouts',async()=>{
   await nav('portfolio');await page.getByRole('heading',{name:/포트폴리오/}).first().waitFor();await shot('portfolio-desktop');
   await page.setViewportSize({width:390,height:844});
   for(const id of ['overview','equities','news','research','portfolio']){await nav(id);await delay(600);check(`${id} mobile no page overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot(id+'-mobile');}
   await page.locator('.tm-areas').getByRole('button',{name:/트레이딩/}).click();await page.waitForURL(u=>u.hash==='#trading/dash');
   check('trading has separate navigation',await page.getByRole('navigation',{name:'트레이딩 기능'}).isVisible());
   await page.getByRole('navigation',{name:'트레이딩 기능'}).getByRole('button',{name:/라이언 가이드/}).click();await page.frameLocator('iframe[title="TM26 트레이딩 및 리서치"]').locator('#page-ryan').waitFor({state:'visible'});check('legacy trading tools remain reachable');
  });
  check('no uncaught browser runtime errors',errors.length===0);
 }finally{fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({base,checks,failures,skipped,errors,observations,fixture:false},null,2));await browser.close();console.log('REPORT',path.join(artifacts,'report.json'));}
 assert.equal(failures.length,0,`${failures.length} failed stories`);
})().catch(e=>{console.error(e);process.exit(1)});

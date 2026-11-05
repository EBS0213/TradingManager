// Browser → ETF catalog → filter → security detail. Uses live public data.
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.argv[2]||'http://localhost:3126';
const local=new URL(base).hostname==='localhost';
const output='/private/tmp/tm26-sector-etf-qa';fs.mkdirSync(output,{recursive:true});

(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage(),checks=[],errors=[];
 page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message));
 const check=(name,value)=>{assert(value,name);checks.push(name);console.log('PASS',name)};
 try{
  const kr=await context.request.get(`${base}/api/terminal/equities?market=KR&kind=etf&sector=all&pageSize=2`,{timeout:65000});
  check('Korean sector ETF API 200',kr.status()===200);
  const korea=await kr.json();
  check('Korean industrial catalog exceeds old fixed US eleven',korea.total>100&&korea.totalEtfs>korea.total&&korea.items.length===2);
  check('Korean industry facets sum to classified universe',korea.sectorGroups.reduce((sum,group)=>sum+group.count,0)===korea.total);
  const us=await context.request.get(`${base}/api/terminal/equities?market=US&kind=etf&sector=all&pageSize=2`,{timeout:65000});
  if(local&&us.status()!==200)console.log('SKIP local US paid data is production-only');
  else{
   check('US sector ETF API 200',us.status()===200);
   const usa=await us.json();
   check('US industry catalog exceeds old fixed eleven',usa.total>100&&usa.totalEtfs>usa.total);
   check('US industry facets sum to classified universe',usa.sectorGroups.reduce((sum,group)=>sum+group.count,0)===usa.total);
  }
  await page.goto(`${base}/#terminal/sectors`,{waitUntil:'domcontentloaded',timeout:65000});
  await page.getByRole('heading',{name:'섹터 ETF',exact:true}).waitFor();
  check('dedicated sector screen opens with Korean market',await page.getByLabel('조회 시장',{exact:true}).inputValue()==='KR');
  await page.getByLabel('산업 분류',{exact:true}).selectOption('technology');
  await page.getByRole('searchbox',{name:'종목 검색',exact:true}).fill('0005G0');
  await page.getByRole('button',{name:'0005G0',exact:true}).waitFor();
  check('Korean semiconductor ETF is in technology',await page.locator('table tbody tr').first().getByText('정보기술',{exact:true}).isVisible());
  await page.getByRole('button',{name:'0005G0',exact:true}).click();
  await page.getByRole('region',{name:'선택 종목 시세'}).getByText('KRW',{exact:true}).waitFor();
  await page.getByRole('img',{name:/0005G0 .*가격 차트/}).waitFor();
  check('Korean industry ETF has KRW detailed quote',await page.getByRole('img',{name:/0005G0 .*가격 차트/}).isVisible());
  await page.screenshot({path:`${output}/korea-technology.png`,fullPage:true});
  if(!local||us.status()===200){
   await page.getByLabel('조회 시장',{exact:true}).selectOption('US');
   await page.getByRole('searchbox',{name:'종목 검색',exact:true}).fill('XLK');
   await page.getByRole('button',{name:'XLK',exact:true}).waitFor();
   check('US technology ETF is searchable by ticker',await page.locator('table tbody tr').first().getByText('정보기술',{exact:true}).isVisible());
   await page.getByRole('button',{name:'XLK',exact:true}).click();
   await page.getByRole('region',{name:'선택 종목 시세'}).getByText('USD',{exact:true}).waitFor();
   await page.getByRole('img',{name:/XLK .*가격 차트/}).waitFor();
   check('US industry ETF has USD detailed quote',await page.getByRole('img',{name:/XLK .*가격 차트/}).isVisible());
   await page.screenshot({path:`${output}/us-technology.png`,fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:`${output}/mobile.png`,fullPage:true});
  check('mobile sector screen has no page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  check('browser has no runtime errors',errors.length===0);
  fs.writeFileSync(`${output}/result.json`,JSON.stringify({base,checks,errors,kr:{classified:korea.total,allEtfs:korea.totalEtfs,coverage:korea.coverage},usStatus:us.status()},null,2));
  console.log('RESULT',`${output}/result.json`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});

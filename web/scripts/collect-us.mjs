import fs from 'node:fs/promises'
import path from 'node:path'
import {catalog,dailyBars,dataRoot,saveJson,readJson,closedUsDate} from '../lib/local-market.mjs'
const args=process.argv.slice(2),limit=Number(args[args.indexOf('--limit')+1])||0
const all=await catalog(),items=all.filter(x=>['CS','ETF'].includes(x.securityType))
const priority=new Set(['SPY','QQQ','DIA','IWM','AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA'])
items.sort((a,b)=>Number(priority.has(b.symbol))-Number(priority.has(a.symbol))||Number(a.kind==='etf')-Number(b.kind==='etf')||a.symbol.localeCompare(b.symbol))
if(args.includes('--catalog-only')){console.log('미국 종목 목록 '+items.length);process.exit(0)}
const chosen=limit?items.slice(0,limit):items
const lock=path.join(dataRoot(),'us-collection.lock')
await fs.mkdir(dataRoot(),{recursive:true})
try {await fs.writeFile(lock,String(process.pid),{flag:'wx',mode:0o600})}
catch(error) {
  if(error.code!=='EEXIST')throw error
  const pid=Number(await fs.readFile(lock,'utf8'))
  let alive=true
  try{process.kill(pid,0)}catch(e){if(e.code==='ESRCH')alive=false;else throw e}
  if(alive)throw new Error('미국 시세 수집이 이미 진행 중입니다.')
  await fs.unlink(lock);await fs.writeFile(lock,String(process.pid),{flag:'wx',mode:0o600})
}
let ok=0,checked=0,failed=[],stopped=false
const startedAt=new Date().toISOString()
try {
  let cursor=0
  const checkpoint=()=>saveJson(path.join(dataRoot(),'us-collection-status.json'),{startedAt,day:closedUsDate(),total:chosen.length,checked,ok,failed:failed.length,lastErrors:failed.slice(-10),updatedAt:new Date().toISOString(),running:true})
  async function worker(){
    while(!stopped&&cursor<chosen.length){
      const item=chosen[cursor++]
      try {await dailyBars(item.symbol,1300,{live:args.includes('--live')});ok++}
      catch(error){failed.push({symbol:item.symbol,error:error.message});if([401,403,429].includes(error.status))stopped=true}
      checked++
      if(checked===1||checked%25===0){await checkpoint();console.log(`미국 일봉 ${checked}/${chosen.length} · 정상 ${ok} · 누락 ${failed.length}`)}
      await new Promise(r=>setTimeout(r,700))
    }
  }
  await Promise.all([worker(),worker()])
  // Build same-date cross sections. Missing symbols are never silently called "all stocks".
  const days={};let observed=0
  for(const item of items) {
    const saved=await readJson(path.join(dataRoot(),'us-bars',item.symbol+'.json'))
    if(!saved?.bars?.length)continue
    observed++
    const rows=saved.bars
    for(let i=Math.max(1,rows.length-6);i<rows.length;i++) {
      const x=rows[i],previous=rows[i-1].c,day=`${x.d.slice(0,4)}-${x.d.slice(4,6)}-${x.d.slice(6,8)}`
      ;(days[day]??={rows:[]}).rows.push({sym:item.symbol,o:x.o,h:x.h,l:x.l,c:x.c,v:x.v,rate:previous?(x.c/previous-1)*100:null,amt:x.c*x.v})
    }
  }
  const coverage={expected:items.length,observed,checked,ok,failed:failed.length,partial:Boolean(limit||stopped||failed.length||observed<items.length)}
  for(const entry of Object.values(days))entry.coverage={expected:items.length,observed:entry.rows.length,partial:entry.rows.length<items.length}
  if(observed)await saveJson(path.join(dataRoot(),'us-market.json'),{source:'Yahoo Finance',fetchedAt:new Date().toISOString(),days,coverage})
  await saveJson(path.join(dataRoot(),'us-collection-status.json'),{startedAt,day:closedUsDate(),finishedAt:new Date().toISOString(),running:false,coverage,failed,stopped})
  console.log(JSON.stringify(coverage));if(stopped)process.exitCode=2
}finally{await fs.unlink(lock)}

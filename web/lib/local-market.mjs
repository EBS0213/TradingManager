// Daily, personal-use observations. No paid API keys or cloud database.
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'

export const dataRoot = () => process.env.TM26_LOCAL_DATA || path.resolve(process.cwd(), '../data')
const validSymbol = /^[A-Z][A-Z0-9.\-]{0,14}$/
const pending = new Map()
const writes = new Map()
export async function saveJson(file, value) {
  file = path.resolve(file)
  const key = process.platform === 'win32' ? file.toLowerCase() : file
  // Windows cannot always replace a destination while another replacement is
  // pending. Queue writers for this file; unrelated files remain independent.
  const previous = writes.get(key) || Promise.resolve()
  const work = previous.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(file), {recursive:true})
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(value), {mode:0o600, flag:'wx'})
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(temporary, file); break }
        catch (error) {
          // Readers in another process or antivirus can briefly hold the file.
          // Keep the old cache intact and stop retrying persistent failures.
          if (process.platform !== 'win32' || attempt >= 7 ||
              !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
          await delay(Math.min(10 * 2 ** attempt, 200))
        }
      }
    } finally {
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
  })
  writes.set(key, work)
  try {
    await work
  } finally {
    if (writes.get(key) === work) writes.delete(key)
  }
}
export async function readJson(file) { try { return JSON.parse(await fs.readFile(file,'utf8')) } catch { return null } }
export function closedUsDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]))
  const d = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`)
  // Wait until 18:00 ET; never persist an unfinished daily candle as a close.
  if(Number(parts.hour)<18)d.setUTCDate(d.getUTCDate()-1)
  while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()-1)
  return d.toISOString().slice(0,10)
}
export function parseYahooBars(body, symbol, cutoff=closedUsDate()) {
  const r=body?.chart?.result?.[0]
  if(body?.chart?.error || !r || String(r.meta?.symbol).toUpperCase()!==symbol.replaceAll('.','-').toUpperCase())throw new Error('Yahoo 종목 확인 실패')
  const q=r.indicators?.quote?.[0]
  if(!q)throw new Error('Yahoo 일봉 없음')
  const finite=x=>typeof x==='number'&&Number.isFinite(x)
  const rows=(r.timestamp||[]).map((stamp,i)=>({d:new Intl.DateTimeFormat('en-CA',{timeZone:r.meta.exchangeTimezoneName||'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp*1000)).replaceAll('-',''),o:q.open?.[i],h:q.high?.[i],l:q.low?.[i],c:q.close?.[i],v:q.volume?.[i]}))
    .filter(x=>x.d<=cutoff.replaceAll('-','')&&[x.o,x.h,x.l,x.c,x.v].every(finite)&&x.c>0&&x.v>=0)
  if(!rows.length)throw new Error('완료된 미국 일봉이 없습니다')
  // Yahoo chart OHLC is split adjusted; do not mix dividend-adjusted Close with raw OHL.
  return rows.sort((a,b)=>a.d.localeCompare(b.d))
}
export function parseYahooObservation(body, symbol) {
  const r=body?.chart?.result?.[0], meta=r?.meta;
  if(!meta || String(meta.symbol).toUpperCase()!==symbol.replaceAll('.','-').toUpperCase())return null;
  const i=(r.timestamp?.length||0)-1,q=r.indicators?.quote?.[0];
  if(i<0||!q)return null;
  const date=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp*1000)).replaceAll('-','');
  if(!Number.isFinite(meta.regularMarketTime)||date(r.timestamp[i])!==date(meta.regularMarketTime))return null;
  const row={d:date(meta.regularMarketTime),o:q.open?.[i],h:q.high?.[i],l:q.low?.[i],c:q.close?.[i],v:q.volume?.[i]};
  if(!Object.values(row).slice(1).every(Number.isFinite)||row.c<=0||row.v<0)return null;
  return {...row,observedAt:new Date(meta.regularMarketTime*1000).toISOString(),source:'Yahoo Finance',session:'regular'};
}
export async function dailyBars(symbol, count=520, {force=false,live=false}={}) {
  symbol=String(symbol).toUpperCase()
  if(!validSymbol.test(symbol))throw new Error('종목코드 형식 확인 실패')
  const file=path.join(dataRoot(),'us-bars',symbol+'.json'),saved=await readJson(file)
  if(!force&&!live&&saved?.checkedDay===closedUsDate()&&saved?.bars?.length)return saved.bars.slice(-count)
  if(live&&!force&&saved?.checkedDay===closedUsDate()&&saved?.bars?.length){
    const observation=await readJson(path.join(dataRoot(),'us-live',symbol+'.json'))
    if(observation&&Date.now()-Date.parse(observation.fetchedAt)<90*60*1000)return saved.bars.slice(-count)
  }
  if(pending.has(symbol))return (await pending.get(symbol)).slice(-count)
  const work=(async()=>{
    const incremental=live&&saved?.checkedDay===closedUsDate()&&saved?.bars?.length;
    const response=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.replaceAll('.','-'))}?range=${incremental?'5d':'5y'}&interval=1d`,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000),cache:'no-store'})
    if(!response.ok){const error=new Error(`Yahoo HTTP ${response.status}`);error.status=response.status;throw error}
    const body=await response.json(),fresh=parseYahooBars(body,symbol)
    const bars=incremental?[...new Map([...saved.bars,...fresh].map(row=>[row.d,row])).values()].sort((a,b)=>a.d.localeCompare(b.d)):fresh
    if(live){const observation=parseYahooObservation(body,symbol);if(observation)await saveJson(path.join(dataRoot(),'us-live',symbol+'.json'),{symbol,...observation,fetchedAt:new Date().toISOString()})}
    await saveJson(file,{symbol,source:'Yahoo Finance',checkedDay:closedUsDate(),fetchedAt:new Date().toISOString(),bars})
    return bars
  })().finally(()=>pending.delete(symbol))
  pending.set(symbol,work)
  return (await work).slice(-count)
}
export async function catalog({refresh=false}={}) {
  const file=path.join(dataRoot(),'us-catalog.json'),saved=await readJson(file)
  if(!refresh&&saved?.items?.length&&Date.now()-Date.parse(saved.fetchedAt)<86400000)return saved.items
  if(pending.has('catalog'))return pending.get('catalog')
  const task=(async()=>{
  try {
    const r=await fetch('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt',{signal:AbortSignal.timeout(30000)})
    if(!r.ok)throw new Error(`Nasdaq HTTP ${r.status}`)
    const [header,...lines]=(await r.text()).trim().split(/\r?\n/),keys=header.split('|')
    const items=lines.map(line=>Object.fromEntries(line.split('|').map((v,i)=>[keys[i],v])))
      .filter(x=>x['Test Issue']==='N'&&validSymbol.test(x.Symbol)&&x['Security Name'])
      .map(x=>({symbol:x.Symbol,name:x['Security Name'],kind:x.ETF==='Y'?'etf':'stock',securityType:x.ETF==='Y'?'ETF':/warrant|preferred|depositary shares|rights|units\b/i.test(x['Security Name'])?'OTHER':'CS',exchange:x['Listing Exchange'],value:1,status:'available'}))
    if(items.length<1000)throw new Error('미국 종목 목록이 불완전합니다')
    await saveJson(file,{fetchedAt:new Date().toISOString(),source:'Nasdaq Trader',items});return items
  } catch(error) { if(saved?.items?.length)return saved.items;throw error }
  })().finally(()=>pending.delete('catalog'))
  pending.set('catalog',task)
  return task
}
export async function marketDay(day=closedUsDate()) {
  const payload=await readJson(path.join(dataRoot(),'us-market.json'))
  const entry=payload?.days?.[day]
  if(!entry?.rows?.length)throw new Error(`${day} 미국 일봉 수집이 아직 완료되지 않았습니다`)
  return {...entry,day,total:entry.rows.length,coverage:entry.coverage||payload.coverage}
}

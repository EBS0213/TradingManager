import {cachedEconomy} from './economy-cache'
import {ASSET_GROUPS,naverAsset,upbitAsset,unavailableAsset} from './assets-data.mjs'

const TTL=300_000
// All asset groups share this ceiling. No unbounded per-symbol fanout.
let active=0
const queue=[]
const cooldown=new Map(),previous=new Map()
function acquire(signal) {
  if(signal.aborted)return Promise.reject(signal.reason)
  if(active<6){active++;return Promise.resolve()}
  return new Promise((resolve,reject)=>{
    const item={resolve:()=>{signal.removeEventListener('abort',cancel);resolve()}}
    const cancel=()=>{const i=queue.indexOf(item);if(i>=0)queue.splice(i,1);reject(signal.reason)}
    signal.addEventListener('abort',cancel,{once:true});queue.push(item)
  })
}
function release() {const next=queue.shift();if(next)next.resolve();else active--}
async function request(url,deadline) {
  const host=new URL(url).host
  if((cooldown.get(host)||0)>Date.now())throw new Error('제공처 요청 제한')
  await acquire(deadline)
  try {
    if(deadline.aborted)throw deadline.reason
    if((cooldown.get(host)||0)>Date.now())throw new Error('제공처 요청 제한')
    const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'},cache:'no-store',
      signal:AbortSignal.any([deadline,AbortSignal.timeout(4500)])})
    if(response.status===429){cooldown.set(host,Date.now()+60_000);throw new Error('제공처 요청 제한')}
    if(!response.ok)throw new Error(`HTTP ${response.status}`)
    return await response.json()
  }finally{release()}
}
async function mapLimited(specs,fn) {
  const results=new Array(specs.length);let cursor=0
  await Promise.all(Array.from({length:Math.min(4,specs.length)},async()=>{
    while(cursor<specs.length){const index=cursor++;results[index]=await fn(specs[index])}
  }))
  return results
}
async function build(group) {
  const specs=ASSET_GROUPS[group],deadline=AbortSignal.timeout(20_000),now=Date.now(),errors=[]
  const read=async(url,label)=>{
    try{return await request(url,deadline)}catch{errors.push(`${label}: 제공처 자료를 확인하지 못했습니다.`);return null}
  }
  let tickers=[]
  if(group==='crypto')tickers=await read(`https://api.upbit.com/v1/ticker?markets=${specs.map(s=>s.code).join(',')}`,'암호화폐 현재가')||[]
  const items=await mapLimited(specs,async spec=>{
    let item
    if(group==='crypto') {
      const history=await read(`https://api.upbit.com/v1/candles/days?market=${spec.code}&count=60`,`${spec.symbol} 일봉`)
      item=upbitAsset(spec,Array.isArray(tickers)?tickers.find(row=>row.market===spec.code):null,history,now)
    }else {
      const [quote,history]=await Promise.all([
        read(`https://api.stock.naver.com/stock/${encodeURIComponent(spec.code)}/basic`,`${spec.symbol} 시세`),
        read(`https://api.stock.naver.com/chart/foreign/item/${encodeURIComponent(spec.code)}?periodType=dayCandle&count=60`,`${spec.symbol} 일봉`),
      ])
      item=naverAsset(spec,quote,history,now)
    }
    const saved=previous.get(spec.code)
    if(!item.history.length && saved?.history?.length)item={...item,history:saved.history,historyStatus:'stale',note:`${item.note} 일봉 갱신에 실패하여 이전 관측 일봉을 표시합니다.`}
    if(item.price===null) {
      if(saved)item={...saved,status:'stale',note:`${saved.note} 새 시세 조회에 실패해 이전 관측값을 표시합니다.`}
    }else previous.set(spec.code,item)
    return {...item,value:item.price}
  })
  const available=items.filter(item=>item.price!==null)
  return {group,series:items,fetchedAt:new Date().toISOString(),
    status:!available.length?'unavailable':available.every(item=>item.status==='stale')?'stale':'delayed',
    errors:[...new Set(errors)],cacheSeconds:TTL/1000,
    note:group==='sectors'?'미국 11개 섹터를 대표하는 Select Sector SPDR ETF 시세입니다. 업종 지수 자체가 아닙니다.':
      group==='crypto'?'업비트 KRW 마켓 8종의 공개 스냅샷입니다. USD 시세와 다를 수 있습니다.':'미국 주요 종목 20개 고정 목록입니다. 전체 종목이나 실시간 시가총액 순위가 아닙니다.'}
}
export async function getTerminalAssets(group='stocks') {
  if(!Object.hasOwn(ASSET_GROUPS,group))throw new RangeError('지원하지 않는 자산 그룹입니다.')
  try {
    // Reuse the existing DB lease, singleflight, 2-second DB deadline and stale fallback.
    const result=await cachedEconomy(`assets_v3_${group}`,TTL,()=>build(group))
    const {series,...metadata}=result
    const items=series.map(({value,...item})=>item)
    const available=items.filter(item=>item.price!==null)
    return {...metadata,items,status:!available.length?'unavailable':available.every(item=>item.status==='stale')?'stale':'delayed',
      coverage:{available:available.length,total:items.length}}
  }catch {
    return {group,items:ASSET_GROUPS[group].map(unavailableAsset),fetchedAt:new Date().toISOString(),status:'unavailable',
      coverage:{available:0,total:ASSET_GROUPS[group].length},cacheSeconds:TTL/1000,
      errors:['자산 데이터를 갱신 중이거나 제공처 연결을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.']}
  }
}

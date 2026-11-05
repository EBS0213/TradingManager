const NAVER = 'https://api.stock.naver.com/futures';
export const FUTURE_CODES = {NQ:'NQ1!',ES:'ES1!','K200-F':'K2I1!','K150-F':'KQI1!','K200-NIGHT':'K2I1! 야간'};
export const FUTURES = [
  { symbol: 'NQ', name: '나스닥100 선물', code: 'NQcv1', exchange: 'CME', currency: 'USD', source: { name: 'Npay 증권', url: 'https://m.stock.naver.com/worldstock/futures/NQcv1/total' } },
  { symbol: 'ES', name: 'S&P 500 선물', code: 'EScv1', exchange: 'CME', currency: 'USD', source: { name: 'Npay 증권', url: 'https://m.stock.naver.com/worldstock/futures/EScv1/total' } },
  { symbol: 'K200-F', name: '코스피200 주간선물', key: 'krnight', chart: 'KRNIGHT', exchange: 'KRX', currency: 'KRW', source: { name: '주식매니저', url: 'https://stock-manager.co.kr/futures/' } },
  { symbol: 'K150-F', name: '코스닥150 주간선물', key: 'kqnight', chart: 'KQFUT', exchange: 'KRX', currency: 'KRW', source: { name: '주식매니저', url: 'https://stock-manager.co.kr/futures/' } },
  { symbol: 'K200-NIGHT', name: '코스피200 야간선물', exchange: 'KRX', currency: 'KRW', source: { name: '개미집 야간선물', url: 'https://gaemizip.com/night' } },
];
const num = value => {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).replace(/,/g, '').replace(/%$/, '');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
};
const iso = value => { const date = new Date(value ?? NaN); return Number.isFinite(date.getTime()) ? date.toISOString() : null; };
const empty = spec => ({ symbol: spec.symbol, name: spec.name, exchange: spec.exchange, currency: spec.currency, source: spec.source, price: null, changePercent: null, asOf: null, fetchedAt: null, status: 'unavailable', delayMinutes: null, session: null, contract: null, marketStatus: null });
export function naverFuture(spec, quote, now) {
  const item = empty(spec);
  if (quote?.reutersCode !== spec.code) return item;
  const price = num(quote.closePrice), asOf = iso(quote.localTradedAt), delayMinutes = num(quote.delayTime);
  if (price === null || price <= 0 || !asOf) return item;
  const stale = quote.marketStatus === 'OPEN' && Date.parse(now) - Date.parse(asOf) > ((delayMinutes ?? 10) + 5) * 60_000;
  return { ...item, price, changePercent: num(quote.fluctuationsRatio), asOf, fetchedAt: now, delayMinutes, contract: quote.month || null, marketStatus: quote.marketStatus || null,
    status: stale ? 'stale' : delayMinutes === 0 ? 'realtime' : delayMinutes > 0 ? 'delayed' : 'unknown' };
}
export function domesticFuture(spec, rows, now) {
  const item = empty(spec), quote = Array.isArray(rows) ? rows.find(row => row.key === spec.key) : null;
  const price = num(quote?.value);
  if (price === null || price <= 0 || quote?.session !== '주간') return item;
  // The feed supplies no observation time or latency guarantee. Do not label it realtime.
  return { ...item, price, changePercent: num(quote.pct), fetchedAt: now, status: 'unknown', session: quote.session };
}
export function nightFuture(spec, body, now) {
  const item = empty(spec), quote = body?.kospi;
  const price = num(quote?.last), asOf = iso(quote?.freshness?.sourceAt) || (Number.isFinite(quote?.ts) ? iso(quote.ts) : null);
  if (quote?.ok !== true || price === null || price <= 0 || !asOf) return item;
  const closed = quote.freshness?.marketState === 'closed';
  const stale = !closed && (Date.parse(now) - Date.parse(asOf) > 180_000 || quote.freshness?.sourceState !== 'current');
  return { ...item, price, changePercent: num(quote.pct), asOf, fetchedAt: now, status: stale ? 'stale' : 'observed', session: '야간', contract: quote.contract || null, marketStatus: closed ? 'CLOSED' : 'OPEN' };
}
const TTL = 30_000;
let cached = null, checkedAt = 0, pending = null;
async function read(url) {
  const response = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
const dayPath = spec => `https://stock-manager.co.kr/api/market/index-chart?symbol=${spec.chart}&days=250`;
export function dayFuture(spec, body, now) {
  const history = futureHistory(spec, body), last = history.at(-1), prior = history.at(-2);
  if (!last) return empty(spec);
  const change = prior ? last.value - prior.value : null;
  return { ...empty(spec), price:last.value, changePercent:prior?.value ? change/prior.value*100 : null,
    fetchedAt:now, asOf:last.time, session:'주간', status:'unknown', history, previousClose:prior?.value??null };
}
async function load() {
  const results = await Promise.allSettled([
    read(`${NAVER}/NQcv1/basic`), read(`${NAVER}/EScv1/basic`),
    read(dayPath(FUTURES[2])), read(dayPath(FUTURES[3])), read('https://gaemizip.com/api/night'),
  ]);
  const now = new Date().toISOString(), errors = [];
  const items = FUTURES.map((spec, index) => {
    const result = results[index];
    let item = empty(spec);
    if (result.status === 'fulfilled') {
      const body = result.value;
      item = index < 2 ? naverFuture(spec, body, now) : index < 4 ? dayFuture(spec, body, now) :
        { ...nightFuture(spec, body, now), history:futureHistory(spec, body), previousClose:num(body?.kospi?.prev_ref) };
    }
    if (item.price === null) {
      errors.push(`${spec.name}: 공급원 조회 실패`);
      const prior = cached?.items.find(row => row.symbol === spec.symbol && row.price !== null);
      if (prior) item = { ...prior, status: 'stale' };
    }
    return item;
  });
  return { items, fetchedAt: now, refreshSeconds: TTL / 1000, errors };
}
export async function getFutures() {
  if (cached && Date.now() - checkedAt < TTL) return cached;
  if (!pending) pending = load().then(data => { cached = data; checkedAt = Date.now(); return data; }).finally(() => { pending = null; });
  return pending;
}

export function futureHistory(spec,body){
  const points=new Map();
  if(spec.symbol==='K200-NIGHT'){
    const quote=body?.kospi;
    for(const row of quote?.ok===true&&Array.isArray(quote.hist)?quote.hist:[]){
      const minute=num(row?.[0]),value=num(row?.[1]);
      if(minute===null||minute<20_000_000||minute>100_000_000||value===null||value<=0)continue;
      const time=iso(minute*60_000);
      if(time&&(!quote.ts||Date.parse(time)<=quote.ts+60_000))points.set(time,{time,value});
    }
  }else{
    if(spec.code&&(body?.code!==spec.code||body?.infoType!=='futures'))return [];
    const rows=spec.code?body.priceInfos:Array.isArray(body)?body:[];
    for(const row of rows||[]){
      const raw=String(row.localDate||row.date||''),time=/^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`:raw;
      const value=num(row.closePrice??row.close);
      if(!/^20\d{2}-\d{2}-\d{2}$/.test(time)||!iso(time)||new Date(time).toISOString().slice(0,10)!==time||value===null||value<=0)continue;
      points.set(time,{time,value,close:value,open:num(row.openPrice??row.open),high:num(row.highPrice??row.high),low:num(row.lowPrice??row.low),volume:num(row.accumulatedTradingVolume??row.volume)});
    }
  }
  return [...points.values()].sort((a,b)=>a.time.localeCompare(b.time)).slice(spec.symbol==='K200-NIGHT'?-900:-250);
}

const assetCache=new Map(),assetPending=new Map();
export async function getFutureAsset(symbol){
  const spec=FUTURES.find(row=>row.symbol===symbol);
  if(!spec)return null;
  const saved=assetCache.get(symbol);
  if(saved&&Date.now()-saved.at<TTL)return saved.item;
  if(assetPending.has(symbol))return assetPending.get(symbol);
  const task=(async()=>{
    const [quotes,body]=await Promise.all([getFutures(),spec.code?read(`https://api.stock.naver.com/chart/foreign/futures/${spec.code}?periodType=dayCandle&count=250`).catch(()=>null):null]);
    const quote=quotes.items.find(row=>row.symbol===symbol)||empty(spec);
    let history=spec.code?futureHistory(spec,body):(quote.history||[]),historyStatus=history.length?(quote.status==='stale'?'stale':'available'):'unavailable';
    if(!history.length&&saved?.item.history.length){history=saved.item.history;historyStatus='stale';}
    const night=symbol==='K200-NIGHT',day=new Date(quote.asOf||quote.fetchedAt||Date.now()).toLocaleDateString('en-CA',{timeZone:spec.exchange==='CME'?'America/Chicago':'Asia/Seoul'});
    const previousClose=spec.code?history.filter(point=>point.time<day).at(-1)?.value??null:quote.previousClose??null;
    const item={...quote,symbol:FUTURE_CODES[symbol],futureSymbol:symbol,kind:'future',currency:'pt',previousClose,
      change:quote.price!==null&&previousClose!==null?Number((quote.price-previousClose).toFixed(4)):null,
      volume:night?null:history.at(-1)?.volume??null,volumeUnit:'contracts',history,historyStatus,
      historyAsOf:history.at(-1)?.time||null,
      historyGranularity:night?'minute':'day',
      note:night?'코스피200 야간선물의 마지막 야간 세션 1분 관측입니다. 주간 선물과 구분합니다.':
        '최근월 연속 선물의 공급처 일봉입니다. 계약 교체 시 가격 차이가 생길 수 있으며 당일 봉은 미완료일 수 있습니다.'};
    assetCache.set(symbol,{at:Date.now(),item});return item;
  })().finally(()=>assetPending.delete(symbol));
  assetPending.set(symbol,task);return task;
}

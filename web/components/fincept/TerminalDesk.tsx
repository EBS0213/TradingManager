"use client";

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, Maximize2, Search, Star } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Asset, Point, NewsItem, asOf, change, direction, indexAsset, number, searchKey, useDeskData, valid } from './data';
import NewsDesk from './NewsDesk';
import BriefingPanel from './BriefingPanel';
import FuturesDashboard from './FuturesDashboard';
import { useDashboardLayout } from './useDashboardLayout';
import type { EconomySeries } from '../economy/types';

type Navigate = (page: string) => void;
const equityMarket = (symbol: string) => /^[0-9][0-9A-Z]{5}$/.test(symbol) ? 'KR' : 'US';
function missingWatchAsset(symbol: string): Asset {
  const market = equityMarket(symbol);
  return { symbol, name: symbol, kind: 'stock', currency: market === 'KR' ? 'KRW' : 'USD', exchange: market, price: null, previousClose: null, change: null, changePercent: null, volume: null, asOf: null, status: 'unavailable', history: [], source: { name: '시세 미제공', url: `/api/terminal/equities?${new URLSearchParams({ symbol, market })}` }, note: '저장된 종목입니다. 상세 시세를 조회할 수 없으면 값이 표시되지 않습니다.' };
}
async function readWatchEquities(symbols: string[], signal: AbortSignal): Promise<Asset[]> {
  let next = 0;
  const result: Asset[] = new Array(symbols.length);
  await Promise.all(Array.from({ length: Math.min(4, symbols.length) }, async () => {
    while (next < symbols.length) {
      const index = next++, symbol = symbols[index];
      if (signal.aborted) throw new DOMException('조회 취소', 'AbortError');
      result[index] = missingWatchAsset(symbol);
      try {
        const response = await fetch(`/api/terminal/equities?${new URLSearchParams({ symbol, market: equityMarket(symbol) })}`, { signal });
        if (!response.ok) continue;
        const body = await response.json();
        if (body.item?.symbol === symbol && Array.isArray(body.item.history) && body.item.source?.name) result[index] = body.item;
      } catch (error) { if (signal.aborted) throw error; }
    }
  }));
  return result;
}

export function Panel({ title, code, onOpen, className = '', children }: { title: string; code?: string; onOpen?: () => void; className?: string; children: ReactNode }) {
  return <section className={`fc-panel ${className}`}><div className="fc-panel-head"><h2>{title}</h2>{code && <span>{code}</span>}{onOpen && <button onClick={onOpen} title={`${title} 전체 보기`} aria-label={`${title} 전체 보기`}><Maximize2 size={13} /></button>}</div>{children}</section>;
}

function PriceChart({ points, compact = false }: { points: Point[]; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const good = points.filter(p => valid(p.value));
  if (good.length < 2) return <div className="fc-empty">표시할 과거 관측값이 없습니다.</div>;
  const values = good.map(p => p.value), min = Math.min(...values), max = Math.max(...values), span = max - min || Math.abs(max) * .01 || 1;
  const h = compact ? 52 : 210, pad = compact ? 2 : 18;
  const x = (i: number) => 8 + i / (good.length - 1) * 584;
  const y = (v: number) => h - pad - (v - min) / span * (h - pad * 2);
  const path = good.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const selected = hover === null ? good[good.length - 1] : good[Math.min(hover, good.length - 1)];
  const timeLabel=(time:string)=>time.includes('T')?asOf(time):time.slice(0,10);
  return <div className={compact ? 'fc-spark' : 'fc-chart'}>
    {!compact && <div className="fc-chart-readout"><span>{timeLabel(selected.time)}</span><strong>{number(selected.value)}</strong><span>{good.length}개 관측</span></div>}
    <div className="fc-chart-plot"><svg preserveAspectRatio="none" viewBox={`0 0 600 ${h}`} role="img" aria-label={`${timeLabel(good[0].time)}부터 ${timeLabel(good[good.length - 1].time)}까지 가격 추이`} onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(good.length - 1, Math.round((e.clientX - r.left) / r.width * (good.length - 1))))); }} onMouseLeave={() => setHover(null)}>
      {!compact && [0, .5, 1].map(t => <g key={t}><line x1="8" x2="592" y1={y(min + t * span)} y2={y(min + t * span)} stroke="#242424" strokeDasharray="3 4" /></g>)}
      <path d={path} fill="none" stroke={compact ? (values[values.length - 1] >= values[0] ? '#00c98d' : '#ff536c') : '#ed9c2d'} strokeWidth={compact ? 3 : 1.6} vectorEffect="non-scaling-stroke" />
      {!compact && hover !== null && <circle cx={x(Math.min(hover, good.length - 1))} cy={y(selected.value)} r="4" fill="#f0a230" />}
    </svg>{!compact && <div className="fc-chart-y-axis" aria-hidden="true">{[max,(max+min)/2,min].map((value,index)=><span key={index}>{number(value)}</span>)}</div>}</div>
    {!compact && <div className="fc-chart-axis"><span>{timeLabel(good[0].time)}</span><span>{timeLabel(good[good.length - 1].time)}</span></div>}
  </div>;
}

function AssetTable({ items, selected, onSelect, favorites, onStar, compact = false, showStars = true }: { items: Asset[]; selected?: string; onSelect: (asset: Asset) => void; favorites: string[]; onStar: (id: string) => void; compact?: boolean; showStars?: boolean }) {
  return <div className="fc-table-wrap"><table className={showStars?"fc-table":"fc-table fc-spot-table"}><thead><tr>{showStars&&<th aria-label="관심" />}<th>자산 / 종목</th><th>현재값</th><th>등락률</th>{!compact && <><th>거래량</th><th>기준 시각</th><th>상태</th></>}</tr></thead><tbody>{items.map(item => <tr key={item.symbol} className={selected === item.symbol ? 'fc-selected' : ''}>
    {showStars&&<td><button className={`fc-star ${favorites.includes(item.symbol) ? 'is-saved' : ''}`} aria-label={`${item.symbol} 관심 ${favorites.includes(item.symbol) ? '해제' : '추가'}`} aria-pressed={favorites.includes(item.symbol)} onClick={() => onStar(item.symbol)}><Star size={12} fill={favorites.includes(item.symbol) ? 'currentColor' : 'none'} /></button></td>}
    <th scope="row"><button className="fc-asset-name" onClick={() => onSelect(item)}>{item.symbol}{!compact && <small>{item.name}</small>}</button></th><td className="fc-num">{number(item.price)}{!compact && <small>{item.currency}</small>}</td><td className={`fc-num ${direction(item.changePercent)}`}>{change(item.changePercent)}</td>{!compact && <><td className="fc-num">{number(item.volume, true)}<small>{item.volumeUnit || (item.kind === 'index' ? '미제공' : '')}</small></td><td>{asOf(item.asOf)}</td><td><span className={`fc-tag ${item.status === 'unavailable' ? 'fc-tag-warn' : ''}`}>{item.status === 'unavailable' ? '미제공' : item.status === 'stale' ? '이전 자료' : '지연 시세'}</span></td></>}
  </tr>)}</tbody></table>{!items.length && <div className="fc-empty">조건에 맞는 자산이 없습니다. 검색어·필터를 확인해 주세요.</div>}</div>;
}

function AssetDetail({ asset, loading, onNavigate }: { asset?: Asset; loading?: boolean; onNavigate: Navigate }) {
  const [range, setRange] = useState(60);
  if (!asset) return <div className="fc-empty">{loading ? '시세를 조회하고 있습니다…' : '표에서 자산을 선택하세요.'}</div>;
  const latest = asset.history.at(-1), minute = asset.historyGranularity === 'minute';
  const points = minute && latest ? asset.history.filter(point => Date.parse(point.time) >= Date.parse(latest.time) - range * 60_000) : asset.history.slice(-range);
  const metrics: [string, ReactNode][] = [['전일 종가', number(asset.previousClose)], ['가격 변화', number(asset.change)], [minute?'선택 구간 첫값':'최근 일봉 시가', number(minute?points[0]?.value:latest?.open)], [minute?'선택 구간 고가':'최근 일봉 고가', number(minute&&points.length?Math.max(...points.map(p=>p.value)):latest?.high)], [minute?'선택 구간 저가':'최근 일봉 저가', number(minute&&points.length?Math.min(...points.map(p=>p.value)):latest?.low)], ['거래량', number(asset.volume, true)], ['시가총액', number(asset.marketCap, true)], ['통화', asset.currency]];
  return <div className="fc-detail"><div className="fc-instrument"><div><h2>{asset.symbol}</h2><p>{asset.name}</p></div><div><strong>{number(asset.price)}</strong><span className={direction(asset.changePercent)}>{change(asset.changePercent)}</span></div></div>
    <div className="fc-toolbar"><span>{minute?'야간 · 1분 관측':'일봉'}</span>{(minute?[[60,'1H'],[180,'3H'],[360,'6H'],[900,'ALL']]:[[5,'1W'],[20,'1M'],[60,'3M'],[250,'ALL']]).map(([n,label]) => <button className={`fc-button ${range === n ? 'active' : ''}`} key={n} onClick={() => setRange(Number(n))}>{label}</button>)}</div>
    {loading && !points.length ? <div className="fc-empty">일봉을 불러오고 있습니다…</div> : <PriceChart points={points} />}
    <dl className="fc-metrics">{metrics.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    
  </div>;
}

function EconomicList({ items, onNavigate, destination, limit, loading = false, error = false }: { items: EconomySeries[]; onNavigate: Navigate; destination: string; limit?: number; loading?: boolean; error?: boolean }) {
  const sorted = [...items].sort((a,b) => Number(!valid(a.value)) - Number(!valid(b.value)));
  return <div className="fc-economic-list">{sorted.slice(0, limit).map(item => <div className="fc-economic-row" key={item.id + item.country}><span>{item.name}<small>{item.asOf ? asOf(item.asOf) : '관측일 미제공'}</small></span><strong>{number(item.value)}<small>{item.unit}</small></strong></div>)}{!items.length && <div className="fc-empty">{loading ? '지표를 불러오는 중입니다…' : error ? '지표 조회 실패 · 새로고침으로 다시 조회하세요.' : '현재 제공되는 관측값이 없습니다.'}</div>}</div>;
}


export default function TerminalDesk({ page, initialSearch = '', onNavigate }: { page: string; initialSearch?: string; onNavigate: Navigate }) {
  const data = useDeskData(page);
  const dashboardRef = useDashboardLayout(page === 'overview');
  const [search, setSearch] = useState(initialSearch), [selectedId, setSelectedId] = useState(''), [region, setRegion] = useState('all'), [sort, setSort] = useState('default');
  const [selectedFuture,setSelectedFuture]=useState('');
  const future=useQuery({queryKey:['fincept','future-chart',selectedFuture],enabled:Boolean(selectedFuture),queryFn:async({signal})=>{
    const response=await fetch(`/api/terminal/futures?${new URLSearchParams({symbol:selectedFuture})}`,{signal});
    if(!response.ok)throw new Error('선물 차트를 불러오지 못했습니다.');
    return response.json() as Promise<{item:Asset}>;
  },staleTime:15000,refetchInterval:30000,retry:1});
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => { try { const value = JSON.parse(localStorage.getItem('tm26_fincept_watchlist') || '[]'); if (Array.isArray(value)) setFavorites(value.filter(x => typeof x === 'string')); } catch {} }, []);
  const star = (id: string) => setFavorites(old => { const next = old.includes(id) ? old.filter(x => x !== id) : [...old,id]; try { localStorage.setItem('tm26_fincept_watchlist',JSON.stringify(next)); } catch {} return next; });
  const indices = data.indices.map(indexAsset), stocks = data.stocks.data?.items || [], sectors = data.sectors.data?.items || [], crypto = data.crypto.data?.items || [], economic = data.economy.data?.series || [], news = data.news.data?.items || [];
  const catalog = new Map([...indices,...stocks,...sectors,...crypto].map(asset => [asset.symbol, asset]));
  const watchEnabled = ['overview', 'watchlist'].includes(page);
  const catalogReady = [data.market, data.stocks, data.sectors, data.crypto].every(query => !query.isPending);
  const missingSymbols = [...new Set(favorites)].filter(symbol => !catalog.has(symbol) && /^(?:[0-9][0-9A-Z]{5}|[A-Z][A-Z0-9.\-]{0,14})$/.test(symbol)).sort();
  const extraWatch = useQuery({ queryKey: ['fincept', 'watch-equities', missingSymbols], enabled: watchEnabled && catalogReady && missingSymbols.length > 0, queryFn: ({ signal }) => readWatchEquities(missingSymbols, signal), staleTime: 300_000, retry: 1, refetchOnWindowFocus: false });
  for (const asset of extraWatch.data || []) if (!catalog.has(asset.symbol)) catalog.set(asset.symbol, asset);
  const watchlist = [...new Set(favorites)].map(symbol => catalog.get(symbol) || missingWatchAsset(symbol));
  const sourceItems = page === 'equities' ? stocks : page === 'sectors' ? sectors : page === 'crypto' ? crypto : page === 'watchlist' ? watchlist : indices;
  const items = useMemo(() => sourceItems.filter(x => searchKey(`${x.symbol} ${x.name}`).includes(searchKey(search)) && (region === 'all' || page !== 'market' || data.market.data?.[region] && (data.market.data[region] as {id:string}[]).some(y => y.id === x.symbol))).sort((a,b) => sort === 'up' ? (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity) : sort === 'down' ? (a.changePercent ?? Infinity) - (b.changePercent ?? Infinity) : Number(!valid(a.price)) - Number(!valid(b.price))), [sourceItems, search, region, page, sort, data.market.data]);
  const selected = catalog.get(selectedId) || items[0];
  const economyState = {loading: data.economy.isPending, error: data.economy.isError};
  const currentQuery = page === 'equities' ? data.stocks : page === 'sectors' ? data.sectors : page === 'crypto' ? data.crypto : data.market;
  const choose = (asset: Asset) => {setSelectedFuture('');setSelectedId(asset.symbol);};
  const chartAsset=selectedFuture?future.data?.item:selected;
  const chartLoading=selectedFuture?future.isPending:data.history.isPending;
  const chartError=selectedFuture&&future.isError?<p className="fc-alert" role="alert">선물 차트를 불러오지 못했습니다. <button type="button" onClick={()=>void future.refetch()}>다시 조회</button></p>:null;
  const exportCSV = () => {
    const cell = (v: unknown) => `"${(typeof v === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/u.test(v) ? "'" : '') + String(v ?? '').replace(/"/g,'""')}"`;
    const csv = '\uFEFF' + [['Symbol','Name','Price','Currency','Change %','Volume','As of','Source'],...items.map(x => [x.symbol,x.name,x.price,x.currency,x.changePercent,x.volume,x.asOf,x.source.name])].map(row => row.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); const a=document.createElement('a');a.href=url;a.download=`TM26-${page}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <div className="fc-desk">
    {page !== 'overview' && <div className="fc-toolbar fc-filter"><Search size={13}/><input aria-label="터미널 데이터 검색" value={search} onChange={e => setSearch(e.target.value)} placeholder="종목 · 코드 · 뉴스 검색" />{page === 'market' && <select aria-label="시장 지역" value={region} onChange={e => setRegion(e.target.value)}><option value="all">전체 지역</option><option value="americas">미주</option><option value="emea">유럽·중동·아프리카</option><option value="asiaPacific">아시아·태평양</option></select>}{['market','equities','sectors','crypto','watchlist'].includes(page) && <><select aria-label="자산 정렬" value={sort} onChange={e => setSort(e.target.value)}><option value="default">기본 정렬</option><option value="up">상승률 순</option><option value="down">하락률 순</option></select><button className="fc-button" onClick={exportCSV}><Download size={12} />CSV</button><span>{items.length}개 표시</span></>}</div>}
    {page === 'overview' ? <>
      <div className="fc-ticker-strip">{indices.filter(x => valid(x.price)).slice(0,8).map(x => <button key={x.symbol} onClick={() => choose(x)}><span>{x.symbol}</span><strong>{number(x.price)}</strong><b className={direction(x.changePercent)}>{change(x.changePercent)}</b></button>)}</div>
      <div className="fc-dashboard" ref={dashboardRef}>
        <div className="fc-dashboard-pair">
          <div className="fc-dashboard-column fc-dashboard-market-column">
            <Panel title="글로벌 시장" code={`${indices.filter(x => valid(x.price)).length}/${indices.length}`} className="fc-dash-indices"><FuturesDashboard selected={selectedFuture} onSelect={setSelectedFuture} /><div className="fc-futures-heading"><h3>현물 지수</h3></div><AssetTable items={indices} showStars={false} selected={selectedFuture?undefined:selected?.symbol} onSelect={choose} favorites={favorites} onStar={star} compact /></Panel>
            <Panel title="암호화폐" code="KRW MARKET"><AssetTable items={crypto.slice(0,6)} onSelect={choose} favorites={favorites} onStar={star} compact />{data.crypto.isPending && <div className="fc-empty">암호화폐를 불러오는 중…</div>}</Panel>
            <Panel title="관심 목록" code={`${watchlist.length}`} onOpen={() => onNavigate('watchlist')} className="fc-dash-watchlist"><div className="fc-watchlist-scroll" role="region" aria-label="대시보드 관심 목록" tabIndex={0}>{watchlist.length ? <AssetTable items={watchlist} onSelect={() => onNavigate('watchlist')} favorites={favorites} onStar={star} compact /> : <div className="fc-empty">종목 옆 ☆를 눌러 관심 목록에 추가하세요.</div>}</div></Panel>
          </div>
          <div className="fc-dashboard-column fc-dashboard-focus-column">
            <Panel title="시장 차트" code={chartAsset?.historyGranularity === 'minute' ? 'INTRADAY' : 'DAILY PRICE'} className="fc-dash-chart">{chartError}<AssetDetail key={selectedFuture||selected?.symbol} asset={chartAsset} loading={chartLoading} onNavigate={onNavigate} /></Panel>
            <BriefingPanel />
            <Panel title="헤드라인" code={`${news.length} HEADLINES`} onOpen={() => onNavigate('news')} className={`fc-dash-news ${news.length ? 'has-content' : 'is-empty'}`}><div className="fc-news-wire">{news.map(x => <a key={x.url} href={x.url} target="_blank" rel="noopener noreferrer"><strong>{x.title}</strong></a>)}{!news.length && <div className="fc-empty">{data.news.isPending ? '뉴스를 불러오는 중…' : '뉴스 피드를 조회할 수 없습니다.'}</div>}</div></Panel>
          </div>
        </div>
        <div className="fc-dashboard-pair">
          <div className="fc-dashboard-column fc-dashboard-reference-column">
            <Panel title="섹터 ETF · 미국 대표" code="전체 한국·미국 산업별 보기" onOpen={() => onNavigate('sectors')} className="fc-dash-sector"><div className="fc-sector-grid">{sectors.map(x => <button key={x.symbol} className={direction(x.changePercent)} onClick={() => onNavigate('sectors')}><b>{x.symbol}</b><span>{x.name}</span><strong>{change(x.changePercent)}</strong></button>)}</div>{!sectors.length && <div className="fc-empty">{data.sectors.isError ? '섹터 ETF 조회 실패 · 새로고침으로 재시도' : '섹터 ETF를 불러오는 중…'}</div>}</Panel>
            <Panel title="환율" code="FX"><EconomicList {...economyState} items={economic.filter(x => x.category === 'fx')} onNavigate={onNavigate} destination="fx" limit={7} /></Panel>
            <Panel title="원자재" code="COMMODITIES"><EconomicList {...economyState} items={economic.filter(x => x.category === 'commodities')} onNavigate={onNavigate} destination="commodities" /></Panel>
          </div>
          <div className="fc-dashboard-column fc-dashboard-reference-column">
            <Panel title="주요 주식" code="US TOP 30" onOpen={() => onNavigate('equities')} className="fc-dash-stocks"><div className="fc-major-stocks-scroll" role="region" aria-label="미국 시가총액 상위 30개 주식" tabIndex={0}><AssetTable items={data.majorStocks.data?.items||[]} onSelect={() => onNavigate('equities')} favorites={favorites} onStar={star} compact /></div>{data.majorStocks.isPending && <div className="fc-empty">주식 시세를 불러오는 중…</div>}{data.majorStocks.isError&&<div className="fc-empty">시가총액 순위를 불러오지 못했습니다.</div>}</Panel>
            <Panel title="금리·국채" code="YIELDS"><EconomicList {...economyState} items={economic.filter(x => x.category === 'rates' && /2Y|10Y|30Y|2년|10년|30년/.test(x.id+x.name))} onNavigate={onNavigate} destination="rates" limit={7} /></Panel>
            <Panel title="경제 지표" code="MACRO" onOpen={() => onNavigate('data')}><EconomicList {...economyState} items={economic.filter(x => x.category === 'macro')} onNavigate={onNavigate} destination="data" limit={6} /></Panel>
            <Panel title="시장 개요" code="관측 지수 기준"><div className="fc-detail"><dl className="fc-metrics"><div><dt>상승 지수</dt><dd className="fc-up">{indices.filter(x => valid(x.changePercent) && x.changePercent > 0).length}</dd></div><div><dt>하락 지수</dt><dd className="fc-down">{indices.filter(x => valid(x.changePercent) && x.changePercent < 0).length}</dd></div><div><dt>보합 지수</dt><dd>{indices.filter(x => x.changePercent === 0).length}</dd></div><div><dt>시세 미제공</dt><dd>{indices.filter(x => !valid(x.price)).length}</dd></div></dl></div></Panel>
          </div>
        </div>
      </div>
    </> : page === 'news' ? <NewsDesk items={news} search={search} loading={data.news.isPending} error={data.news.isError} onRetry={()=>{void data.news.refetch();}} /> : <>
      {currentQuery.isError && <div className="fc-alert" role="alert">시세를 불러오지 못했습니다. <button className="fc-button" onClick={() => currentQuery.refetch()}>다시 조회</button></div>}
      {page === 'sectors' && null}
      {page === 'crypto' && null}
      {page === 'watchlist' && !favorites.length && null}
      {page === 'watchlist' && extraWatch.isFetching && <p className="fc-note" role="status">저장한 한국·미국 주식 및 ETF 시세를 조회하고 있습니다…</p>}
      <div className="fc-split"><Panel title="자산 목록" code={currentQuery.isPending ? 'LOADING' : `${items.length} INSTRUMENTS`}><AssetTable items={items} showStars={page!=='market'} selected={selectedFuture?undefined:selected?.symbol} onSelect={choose} favorites={favorites} onStar={star} />{currentQuery.isPending && <div className="fc-empty">실제 공급원에서 자료를 불러오고 있습니다…</div>}</Panel><Panel title="선택 자산" code="OVERVIEW">{chartError}<AssetDetail key={selectedFuture||selected?.symbol} asset={chartAsset} loading={chartLoading} onNavigate={onNavigate}/></Panel></div>
    </>}
    
  </div>;
}

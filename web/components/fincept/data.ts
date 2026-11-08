import { useQuery } from '@tanstack/react-query';
import type { MarketData, MarketItem } from '../bloomberg/types';
import { economyQueryOptions } from '../economy/types';

export type Point = { time: string; value: number; open?: number; high?: number; low?: number; close?: number; volume?: number };
export type Asset = { symbol: string; name: string; kind: string; sector?: string; currency: string; exchange: string; price: number | null; previousClose: number | null; change: number | null; changePercent: number | null; volume: number | null; marketCap?: number | null; volumeUnit?: string; asOf: string | null; status: string; history: Point[]; historyStatus?: string; historyAsOf?: string | null; historyGranularity?: string; source: { name: string; url: string }; note?: string; changeBasis?: string };
export type AssetResponse = { group: string; items: Asset[]; fetchedAt: string; errors: string[]; status: string };
export type NewsItem = { title: string; url: string; source: string; publishedAt: string | null; summary: string; market?: string; category?: string; sectors?: string[]; kind?: string; speakers?: string[]; companies?: string[]; language?: string };
export type NewsResponse = { items: NewsItem[]; lastUpdated: string; status: string };
export async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`자료 조회 실패 (${response.status})`);
  return response.json();
}
export function useDeskData(page: string) {
  const market = useQuery({ queryKey: ['fincept', 'market'], queryFn: ({ signal }) => getJSON<MarketData>('/api/terminal/market-data', signal), staleTime: 60_000, retry: 1, refetchOnWindowFocus: false });
  const history = useQuery({ queryKey: ['fincept', 'history'], queryFn: ({ signal }) => getJSON<MarketData>('/api/terminal/market-data?history=daily', signal), staleTime: 900_000, retry: 1, refetchOnWindowFocus: false, enabled: ['overview', 'market', 'watchlist'].includes(page) });
  const economy = useQuery({...economyQueryOptions('overview'), enabled: page === 'overview'});
  const news = useQuery({ queryKey: ['fincept', 'news'], queryFn: ({ signal }) => getJSON<NewsResponse>('/api/terminal/news', signal), staleTime: 300_000, refetchInterval: 300_000, retry: 1, refetchOnWindowFocus: false, enabled: ['overview', 'news'].includes(page) });
  const majorStocks = useQuery({queryKey:['fincept','major-us-stocks',30],queryFn:({signal})=>getJSON<{items:Asset[];asOf:string}>('/api/terminal/major-stocks',signal),enabled:page==='overview',staleTime:60_000,refetchInterval:60_000,retry:1,refetchOnWindowFocus:false});
  const stocks = useAssets('stocks', ['overview', 'equities', 'watchlist'].includes(page));
  const sectors = useAssets('sectors', ['overview', 'sectors', 'watchlist'].includes(page));
  const crypto = useAssets('crypto', ['overview', 'crypto', 'watchlist'].includes(page));
  const flatten = (data?: MarketData) => [data?.americas, data?.emea, data?.asiaPacific].flatMap(x => x || []);
  const daily = flatten(history.data);
  const indices = flatten(market.data).map(item => {
    const candle = daily.find(x => x.id === item.id);
    return { ...item, dailyHistory: candle?.dailyHistory || [], dailyHistoryStatus: candle?.dailyHistoryStatus, dailyHistoryAsOf: candle?.dailyHistoryAsOf };
  });
  return { market, history, economy, news, stocks, majorStocks, sectors, crypto, indices };
}
function useAssets(group: string, enabled: boolean) {
  return useQuery({ queryKey: ['fincept', 'assets', group], queryFn: ({ signal }) => getJSON<AssetResponse>(`/api/terminal/assets?group=${group}`, signal), enabled, staleTime: 300_000, retry: 1, refetchOnWindowFocus: false });
}
export const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export function number(n: unknown, compact = false) {
  return valid(n) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.abs(n) < 1 ? 5 : 2, notation: compact ? 'compact' : 'standard' }).format(n) : '—';
}
export const change = (n: unknown) => valid(n) ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : '—';
export const direction = (n: unknown) => valid(n) ? n > 0 ? 'fc-up' : n < 0 ? 'fc-down' : 'fc-muted' : 'fc-muted';
export const searchKey = (text: string) => text.toLocaleLowerCase().replace(/코스피/g,'kospi').replace(/코스닥/g,'kosdaq').replace(/나스닥/g,'nasdaq').replace(/다우/g,'dow').replace(/[\s&._-]/g,'');
export function asOf(date?: string | null) {
  if (!date) return '기준일 미제공';
  if (/^\d{4}(?:-\d{2}(?:-\d{2})?|-Q[1-4])?$/.test(date)) return date;
  const time = new Date(date);
  return Number.isNaN(time.getTime()) ? date : time.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + ' KST';
}
export function indexAsset(item: MarketItem): Asset {
  return { symbol: item.id, name: item.id, kind: 'index', currency: 'pt', exchange: 'GLOBAL INDEX', price: valid(item.value) ? item.value : null, previousClose: valid(item.value) && valid(item.change) ? item.value - item.change : null, change: item.change, changePercent: item.pctChange, volume: null, asOf: item.asOf || item.lastUpdated || null, status: item.dataStatus || 'unavailable', history: item.dailyHistory || [], historyStatus:item.dailyHistoryStatus,historyAsOf:item.dailyHistoryAsOf, source: { name: item.source || 'NAVER Finance', url: 'https://stock.naver.com/worldstock' } };
}

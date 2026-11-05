"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Asset, Point } from "./data";
import { asOf, change, direction, number, valid } from "./data";
import { calculateVolatilityMetrics } from "../bloomberg/lib/volatility";
import TradingScore from "./TradingScore";
import StockPriceChart from "./StockPriceChart";
import styles from "./EquityResearch.module.css";

type Source = { name: string; url: string };
type Candle = Omit<Point, "open" | "high" | "low" | "volume"> & {
  open?: number | null; high?: number | null; low?: number | null; volume?: number | null; isComplete?: boolean | null;
};
type UniverseItem = {
  symbol: string; name: string; price: number | null; open: number | null; high: number | null; low: number | null;
  volume: number | null; marketCap?: number | null; turnover?: number | null; changePercent: number | null; previousClose: number | null;
  asOf: string | null; currency: string; sector?: string; status?: string;
};
type UniverseResponse = {
  items: UniverseItem[]; total: number; matched: number; page: number; pageSize: number;
  source?: Source | string; note?: string; status: string; totalEtfs?:number;
  sectorGroups?:{id:string;label:string;count:number}[];
};
type Quarter = { period: string; revenue: number | null; eps: number | null; revenueGrowthPercent: number | null; epsGrowthPercent: number | null };
type Fundamentals = {
  snapshotAsOf?: string | null; eps?: number | null; epsPrior?: number | null; epsGrowthPercent?: number | null; epsBasis?: string;
  revenue?: number | null; revenuePrior?: number | null; revenueGrowthPercent?: number | null; revenueUnit?: string;
  marketSource?:Source;marketAsOf?:string|null;rangeSource?:Source;rangeAsOf?:string|null;profitabilityPeriod?:string;profitabilityAsOf?:string|null;profitabilitySource?:Source;enterpriseToEbitda?:number|null;
  financialPeriod?:string;financialBasis?:string;financialSource?:Source;operatingIncome?:number|null;netIncome?:number|null;netMarginPercent?:number|null;operatingMarginPercent?:number|null;roePercent?:number|null;roePeriod?:string;
  per?:number|null;pbr?:number|null;dividendYieldPercent?:number|null;
  high52?: number | null; low52?: number | null; quarters?: Quarter[]; source?: Source;
};
type EquityItem = Omit<Asset, "history"> & {
  open?: number | null; high?: number | null; low?: number | null; history: Candle[];
  profile?: { description?: string; website?: string; employees?: number | null; exchange?: string; industry?: string; sharesOutstanding?: number | null; sharesAsOf?:string|null;floatShares?:number|null;floatSource?:Source;floatRetrievedAt?:string;source?:Source; marketCap?: number | null };
  fundamentals?: Fundamentals | null;
  consensus?:{mean?:number|null;high?:number|null;low?:number|null;count?:number|null;asOf?:string;retrievedAt?:string;source?:Source};
  yahooStatus?:string;
  trailingFinancials?:{currency:string|null;revenue:number|null;netIncome:number|null;eps:number|null;ebitda:number|null;financialAsOf:string|null;source:Source;retrievedAt:string};
  etf?:{issuer?:string|null;nav?:number|null;totalAssets?:number|null;expenseRatioPercent?:number|null;underlyingIndex?:string|null;return1mPercent?:number|null;return3mPercent?:number|null;return1yPercent?:number|null}|null;
};
type DetailResponse = { item: EquityItem | null; errors?: string[]; note?: string; status?: string };
type StockNews = { title: string; url: string; source: string; day?: string; time?: string };
type NewsResponse = { ok: boolean; items: StockNews[]; source?: string };
type Tab = "overview" | "financials" | "technicals" | "news" | "trading";
type Metric = { label: string; value: ReactNode; note?: string; tone?: string };
type Props = { assetClass?: "all" | "etf"; sectorMode?:boolean; initialSearch?: string; onNavigate: (page: string) => void };
const EMPTY_CANDLES: Candle[] = [];
const EMPTY_ITEMS: UniverseItem[] = [];
const EMPTY_QUARTERS: Quarter[] = [];

function safeUrl(value?: string) {
  if (!value) return undefined;
  if (/^\/#(?:terminal|trading)\//.test(value) && !/[\\\u0000-\u0020]/.test(value)) return value;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

async function readApi<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`자료를 불러오지 못했습니다. (HTTP ${response.status})`);
  return response.json();
}

function sourceName(source?: Source | string) { return typeof source === "string" ? source : source?.name || "공급원 미확인"; }
function description(value?:string) { return value?.replace(/<br\s*\/?\s*>/gi,"\n").replace(/<[^>]*>/g," ").replace(/&nbsp;/gi," ").replace(/[ \t]{2,}/g," ").trim() || "등록된 기업 설명이 없습니다."; }
function unitValue(value: unknown, unit: string, compact = false) { return valid(value) ? `${number(value, compact)} ${unit}` : "—"; }
function percent(value: unknown) { return valid(value) ? `${number(value)}%` : "—"; }
function statusText(status?: string) { return status === "stale" ? "이전 관측 자료" : status === "unavailable" ? "자료 미제공" : "관측 시세 · 지연 자료"; }
function average(values: number[], count: number) { return values.length >= count ? values.slice(-count).reduce((sum, value) => sum + value, 0) / count : null; }
function observedReturn(values: number[], count: number) { return values.length > count && values[values.length - count - 1] > 0 ? (values[values.length - 1] / values[values.length - count - 1] - 1) * 100 : null; }

function Panel({ title, code, children, className = "" }: { title: string; code?: string; children: ReactNode; className?: string }) {
  return <section className={`${styles.panel} ${className}`}><div className={styles.panelHead}><h2>{title}</h2>{code ? <span>{code}</span> : null}</div>{children}</section>;
}

function Metrics({ rows }: { rows: Metric[] }) {
  return <dl className={styles.metrics}>{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd className={row.tone}>{row.value}</dd></div>)}</dl>;
}



function Retry({ text, onRetry, fetching }: { text: string; onRetry: () => void; fetching?: boolean }) {
  return <div className={styles.notice} role="alert"><span>{text}</span><button type="button" onClick={onRetry} disabled={fetching}>{fetching ? "조회 중…" : "다시 조회"}</button></div>;
}

function PriceHistory({ candles, currency, symbol, historyStatus }: { candles: Candle[]; currency: string; symbol: string; historyStatus?: string }) {
  const [count, setCount] = useState(60);
  const [display, setDisplay] = useState<"candle" | "line" | "table">("candle");
  const [cursor, setCursor] = useState<number | null>(null);
  const chartDescriptionId = useId();
  const points = count === 0 ? candles : candles.slice(-count);
  const selected = points.length ? points[Math.min(cursor ?? points.length - 1, points.length - 1)] : undefined;
  const low = points.length ? Math.min(...points.map(point => valid(point.low) ? Math.min(point.low, point.value) : point.value)) : 0;
  const high = points.length ? Math.max(...points.map(point => valid(point.high) ? Math.max(point.high, point.value) : point.value)) : 0;
  const spread = high - low || Math.max(Math.abs(high) * .02, 1);
  const floor = low - spread * .08, ceiling = high + spread * .08;
  const chartLeft = 18, chartRight = 646, priceTop = 22, priceBottom = 263, volumeTop = 290, volumeBottom = 341;
  const x = (index: number) => chartLeft + (index + .5) * (chartRight - chartLeft) / Math.max(points.length, 1);
  const y = (value: number) => priceBottom - (value - floor) / (ceiling - floor) * (priceBottom - priceTop);
  const volumeValues = points.flatMap(point => valid(point.volume) && point.volume >= 0 ? [point.volume] : []);
  const maxVolume = volumeValues.length ? Math.max(...volumeValues) : 0;
  const candleWidth = Math.max(1.2, Math.min(12, (chartRight - chartLeft) / Math.max(points.length, 1) * .62));
  const linePath = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.value)}`).join(" ");
  const selectedIndex = selected ? points.indexOf(selected) : -1;

  return <>
    <div className={styles.chartToolbar}>
      <div className={styles.buttonGroup} aria-label="일봉 관측 범위">{[[5, "5일"], [20, "20일"], [60, "60일"], [0, "전체"]].map(([value, label]) => <button key={value} type="button" aria-pressed={count === value} onClick={() => { setCount(Number(value)); setCursor(null); }}>{label}</button>)}</div>
      <div className={styles.buttonGroup} aria-label="가격 표시 방식">{([["candle", "캔들"], ["line", "선"], ["table", "표"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={display === value} onClick={() => setDisplay(value)}>{label}</button>)}</div>
      <span className={styles.muted}>{currency} · 거래일 기준</span>
    </div>
    {historyStatus === "stale" ? <p className={styles.inlineWarning}>일봉 갱신 실패 · 이전 자료</p> : null}
    {selected ? <div className={styles.ohlcReadout}><strong>{selected.time}</strong>{[["O", selected.open], ["H", selected.high], ["L", selected.low], ["C", selected.value]].map(([label, value]) => <span key={String(label)}>{label} <b>{number(value)}</b></span>)}<span>V <b>{number(selected.volume, true)}</b></span>{selected.isComplete === false ? <em>미완료 일봉</em> : null}</div> : null}
    {!points.length ? <div className={styles.empty}>제공된 일봉이 없습니다. 시세와 일봉의 제공 범위는 다를 수 있습니다.</div>
      : display === "table" ? <div className={styles.historyTable}><table><caption className={styles.srOnly}>{symbol} 관측 일봉, 가격 단위 {currency}, 거래량 단위 주</caption><thead><tr><th scope="col">거래일</th><th scope="col">시가</th><th scope="col">고가</th><th scope="col">저가</th><th scope="col">종가</th><th scope="col">거래량</th></tr></thead><tbody>{[...points].reverse().map(point => <tr key={point.time}><th scope="row">{point.time}{point.isComplete === false ? " *" : ""}</th><td>{number(point.open)}</td><td>{number(point.high)}</td><td>{number(point.low)}</td><td>{number(point.value)}</td><td>{number(point.volume)}</td></tr>)}</tbody></table></div>
        : <div className={styles.chart}>
          <p className={styles.srOnly} id={chartDescriptionId}>관측 일봉입니다. 차트에 초점을 맞춘 뒤 좌우 방향키로 날짜를 선택하거나 표 보기에서 전체 값을 확인할 수 있습니다.</p>
          <svg viewBox="0 0 730 367" role="img" aria-label={`${symbol} ${points[0].time}부터 ${points[points.length - 1].time}까지 ${currency} 가격 차트`} aria-describedby={chartDescriptionId} tabIndex={0}
            onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); const position = (event.clientX - box.left) / box.width * 730; setCursor(Math.max(0, Math.min(points.length - 1, Math.floor((position - chartLeft) / (chartRight - chartLeft) * points.length)))); }}
            onPointerLeave={() => setCursor(null)}
            onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); setCursor(old => event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (old ?? points.length - 1) + (event.key === "ArrowRight" ? 1 : -1)))); }}>
            {[0, .25, .5, .75, 1].map(tick => { const value = floor + (ceiling - floor) * tick; return <g key={tick}><line x1={chartLeft} x2={chartRight} y1={y(value)} y2={y(value)} stroke="#292929" strokeDasharray="3 4" /><text x="660" y={y(value) + 4}>{number(value)}</text></g>; })}
            {display === "line" ? <path d={linePath} fill="none" stroke="#f0ac43" strokeWidth="1.7" vectorEffect="non-scaling-stroke" /> : points.map((point, index) => {
              const complete = valid(point.open) && valid(point.high) && valid(point.low) && point.high >= point.low;
              const color = valid(point.open) && point.value < point.open ? "#ff7185" : "#31d7a0";
              return complete ? <g key={point.time}><line x1={x(index)} x2={x(index)} y1={y(point.high as number)} y2={y(point.low as number)} stroke={color} strokeWidth="1" /><rect x={x(index) - candleWidth / 2} y={Math.min(y(point.open as number), y(point.value))} width={candleWidth} height={Math.max(1, Math.abs(y(point.open as number) - y(point.value)))} fill={color} /></g> : <circle key={point.time} cx={x(index)} cy={y(point.value)} r="2" fill="#f0ac43" />;
            })}
            <line x1={chartLeft} x2={chartRight} y1="280" y2="280" stroke="#363636" />
            {points.map((point, index) => valid(point.volume) && point.volume >= 0 && maxVolume > 0 ? <rect key={`v-${point.time}`} x={x(index) - candleWidth / 2} y={volumeBottom - point.volume / maxVolume * (volumeBottom - volumeTop)} width={candleWidth} height={point.volume / maxVolume * (volumeBottom - volumeTop)} fill={valid(point.open) && point.value < point.open ? "#703442" : "#21674e"} /> : null)}
            <text x="660" y="301">거래량</text><text x="660" y="320">{maxVolume > 0 ? number(maxVolume, true) : "—"}</text>
            {cursor !== null && selected ? <g><line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={priceTop} y2={volumeBottom} stroke="#a7a7a7" strokeDasharray="3 3" /><circle cx={x(selectedIndex)} cy={y(selected.value)} r="3" fill="#fff" /></g> : null}
            <text x={chartLeft} y="360">{points[0].time}</text><text x={chartRight} y="360" textAnchor="end">{points[points.length - 1].time}</text>
          </svg>
        </div>}
    
  </>;
}

function RangePanel({ item, candles }: { item: EquityItem; candles: Candle[] }) {
  const fundamentals = item.fundamentals;
  const has52 = valid(fundamentals?.low52) && valid(fundamentals?.high52) && fundamentals.high52 >= fundamentals.low52;
  const lows = candles.flatMap(point => valid(point.low) ? [point.low] : []), highs = candles.flatMap(point => valid(point.high) ? [point.high] : []);
  const low = has52 ? fundamentals!.low52! : lows.length ? Math.min(...lows) : null;
  const high = has52 ? fundamentals!.high52! : highs.length ? Math.max(...highs) : null;
  const position = valid(low) && valid(high) && high > low && valid(item.price) ? Math.max(0, Math.min(100, (item.price - low) / (high - low) * 100)) : null;
  return <Panel title="가격 범위" code={has52 ? "52 WEEK RANGE" : "OBSERVED RANGE"}>
    <Metrics rows={[{ label: "52주 최고", value: unitValue(fundamentals?.high52, item.currency) }, { label: "52주 최저", value: unitValue(fundamentals?.low52, item.currency) }]} />
    {valid(low) && valid(high) ? <div className={styles.range}><div className={styles.rangeLabels}><span>{number(low)}</span><span>{number(high)}</span></div><div className={styles.rangeTrack}>{position !== null ? <i style={{ left: `${position}%` }} /> : null}</div></div> : <p className={styles.panelNote}>가격 범위 자료가 없습니다.</p>}
    
  </Panel>;
}

function Financials({ item }: { item: EquityItem }) {
  const fundamentals = item.fundamentals;
  const quarters = fundamentals?.quarters ?? EMPTY_QUARTERS;
  return <div className={styles.financials}>
    <Panel title="최근 저장 실적" code="REPORTED FINANCIALS"><Metrics rows={[
      { label: "매출", value: unitValue(fundamentals?.revenue, fundamentals?.revenueUnit || item.currency, true) },
      { label: "전년 매출", value: unitValue(fundamentals?.revenuePrior, fundamentals?.revenueUnit || item.currency, true) },
      { label: "매출 전년 대비", value: percent(fundamentals?.revenueGrowthPercent), tone: direction(fundamentals?.revenueGrowthPercent) },
      { label: "주당순이익", value: unitValue(fundamentals?.eps, `${item.currency}/주`) },
      { label: "전년 주당순이익", value: unitValue(fundamentals?.epsPrior, `${item.currency}/주`) },
      { label: fundamentals?.epsBasis === "순이익" ? "순이익 성장 (대체 지표)" : "EPS 전년 대비", value: percent(fundamentals?.epsGrowthPercent), tone: direction(fundamentals?.epsGrowthPercent) },
      { label: "영업이익", value: unitValue(fundamentals?.operatingIncome,item.currency,true) },
      { label: "당기순이익", value: unitValue(fundamentals?.netIncome,item.currency,true) },
    ]} /></Panel>
    {item.trailingFinancials?.currency ? <Panel title="최근 12개월 실적" code="TTM"><Metrics rows={[
      {label:"매출",value:unitValue(item.trailingFinancials.revenue,item.trailingFinancials.currency,true)},
      {label:"순이익",value:unitValue(item.trailingFinancials.netIncome,item.trailingFinancials.currency,true)},
      {label:"희석 EPS",value:unitValue(item.trailingFinancials.eps,`${item.trailingFinancials.currency}/주`)},
      {label:"EBITDA",value:unitValue(item.trailingFinancials.ebitda,item.trailingFinancials.currency,true)},
    ]}/></Panel>:null}
    <Panel title="분기 실적" code={`${quarters.length} PERIODS`}>
      {quarters.length ? <div className={styles.financialTable}><table><caption className={styles.srOnly}>저장 분기별 실적. 매출 {item.currency}, EPS {item.currency}/주, 성장률 전년 동기 대비</caption><thead><tr><th scope="col">회계기간</th><th scope="col">매출 ({item.currency})</th><th scope="col">매출 YoY</th><th scope="col">EPS ({item.currency}/주)</th><th scope="col">{fundamentals?.epsBasis === "순이익" ? "순이익 YoY (대체)" : "EPS YoY"}</th></tr></thead><tbody>{quarters.map((quarter, index) => <tr key={`${quarter.period}-${index}`}><th scope="row">{quarter.period || "기간 미기재"}</th><td>{number(quarter.revenue)}</td><td className={direction(quarter.revenueGrowthPercent)}>{percent(quarter.revenueGrowthPercent)}</td><td>{number(quarter.eps)}</td><td className={direction(quarter.epsGrowthPercent)}>{percent(quarter.epsGrowthPercent)}</td></tr>)}</tbody></table></div> : <div className={styles.empty}>제공된 분기 이력이 없습니다.</div>}
      
    </Panel>
  </div>;
}

function Technicals({ item, candles, market }: { item: EquityItem; candles: Candle[]; market: "KR"|"US" }) {
  const completed = useMemo(() => candles.filter(point => point.isComplete !== false), [candles]);
  const closes = completed.map(point => point.value);
  const metrics = useMemo(() => calculateVolatilityMetrics({ dailyHistory: candles.map(({ time, value, isComplete }) => ({ time, value, isComplete })) }), [candles]);
  const vol20 = useMemo(() => calculateVolatilityMetrics({ dailyHistory: completed.slice(-21).map(({ time, value, isComplete }) => ({ time, value, isComplete })) }), [completed]);
  return <div className={styles.technicalGrid}>
    <Panel title="이동평균" code="DAILY CLOSE"><Metrics rows={[20, 50, 100, 200].map(days => ({ label: `${days}일 단순 이동평균`, value: unitValue(average(closes, days), item.currency), note: closes.length < days ? `${days}개 완료 관측 필요` : undefined }))} /></Panel>
    <Panel title="모멘텀·변동성" code="OBSERVED METRICS"><Metrics rows={[
      { label: "RSI 14", value: number(metrics.rsi14), note: "Wilder 평활 · 완료 일봉" },
      { label: "20일 실현변동성", value: closes.length >= 21 ? percent(vol20.annualizedVolatilityPct) : "—", note: "로그수익률 표본 표준편차 × √252" },
      { label: "계산에 사용한 일봉", value: `${closes.length}개` },
      { label: "최신 계산 기준일", value: completed.at(-1)?.time || "—" },
    ]} /></Panel>
    <Panel title="관측 기간 수익률" code="PRICE RETURN"><Metrics rows={[5, 20, 60].map(days => ({ label: `${days}거래일 가격 변화`, value: change(observedReturn(closes, days)), tone: direction(observedReturn(closes, days)), note: closes.length <= days ? `${days + 1}개 완료 종가 필요` : undefined }))} /><p className={styles.panelNote}></p></Panel>
    <div className={styles.technicalChart}><Panel title="가격·거래량" code={`${item.currency} · DAILY`}><StockPriceChart key={item.symbol} points={candles} currency={item.currency} symbol={item.symbol} market={market} historyStatus={item.historyStatus} /></Panel></div>
    
  </div>;
}

function CompanyNews({ symbol, name }: { symbol: string; name: string }) {
  const query = useQuery({ queryKey: ["fincept", "equity-news", symbol, name], queryFn: async ({ signal }) => {
    const data = await readApi<NewsResponse>(`/api/stocknews?${new URLSearchParams({ code: symbol, name })}`, signal);
    if (!data.ok || !Array.isArray(data.items)) throw new Error("종목 뉴스 응답을 확인할 수 없습니다.");
    return data;
  }, staleTime: 1_200_000, retry: 1, refetchOnWindowFocus: false });
  return <Panel title={`${symbol} 관련 뉴스`} code="COMPANY NEWS">
    
    {query.isError ? <Retry text="관련 뉴스를 불러오지 못했습니다." onRetry={() => { void query.refetch(); }} fetching={query.isFetching} /> : null}
    {query.isPending ? <div className={styles.empty} role="status">관련 뉴스를 조회하고 있습니다…</div> : query.data?.items.length ? <div className={styles.newsList}>{query.data.items.map((item, index) => {
      const href = safeUrl(item.url);
      return <article key={`${item.url}-${index}`}><div><time>{[item.day, item.time].filter(Boolean).join(" ") || "발행 시각 미제공"}</time></div><h3>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{item.title} ↗</a> : item.title}</h3></article>;
    })}</div> : !query.isError ? <div className={styles.empty}>현재 수집된 뉴스에서 이 종목과 일치하는 기사가 없습니다.</div> : null}
    <div className={styles.newsFooter}><button type="button" onClick={() => { void query.refetch(); }} disabled={query.isFetching}>{query.isFetching ? "조회 중…" : "뉴스 재조회"}</button></div>
  </Panel>;
}

export default function EquityResearch({ initialSearch = "", assetClass = "all", sectorMode = false, onNavigate }: Props) {
  const [market, setMarket] = useState<"US" | "KR">(sectorMode || /^[0-9][0-9A-Z]{5}$|[가-힣]/.test(initialSearch) ? "KR" : "US");
  const marketName = market === "KR" ? "한국" : "미국";
  const [sector, setSector] = useState("all");
  const [input, setInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("volume");
  const [symbol, setSymbol] = useState("");
  const [showList, setShowList] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [actionNotice, setActionNotice] = useState("");
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem("tm26_fincept_watchlist") || "[]"); if (Array.isArray(saved)) setFavorites(saved.filter((value): value is string => typeof value === "string")); } catch { setActionNotice("관심 목록을 읽지 못했습니다. 브라우저 저장 설정을 확인하세요."); } }, []);
  const listId = useId();
  const tabId = useId();
  useEffect(() => { const timer = setTimeout(() => { setSearch(input.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [input]);
  const universe = useQuery({ queryKey: ["fincept", "equities", "universe", market, assetClass, sectorMode ? sector : null, search, page, sort], queryFn: async ({ signal }) => {
    const params = new URLSearchParams({ q: search, page: String(page), pageSize: "50", sort, market, kind: assetClass });
    if (sectorMode) params.set("sector", sector);
    const data = await readApi<UniverseResponse>(`/api/terminal/equities?${params}`, signal);
    if (!Array.isArray(data.items)) throw new Error("종목 목록 응답을 확인할 수 없습니다.");
    return data;
  }, staleTime: 300_000, retry: 1, refetchOnWindowFocus: false });
  const items = universe.data?.items ?? EMPTY_ITEMS;
  const sectorLabel = (id?:string) => universe.data?.sectorGroups?.find(group => group.id === id)?.label || id || "—";
  const selectedRow = items.find(item => item.symbol === symbol) ?? items[0];
  const selectedSymbol = selectedRow?.symbol || "";
  const detail = useQuery({ queryKey: ["fincept", "equities", "detail", market, selectedSymbol], enabled: Boolean(selectedSymbol), queryFn: async ({ signal }) => {
    const data = await readApi<DetailResponse>(`/api/terminal/equities?${new URLSearchParams({ symbol: selectedSymbol, market })}`, signal);
    if (data.item && data.item.symbol !== selectedSymbol) throw new Error("선택 종목과 응답 종목이 일치하지 않습니다.");
    return data;
  }, staleTime: 300_000, retry: 1, refetchOnWindowFocus: false });
  const item = detail.data?.item;
  const fundamentals = item?.fundamentals;
  const candles = useMemo(() => {
    const unique = new Map<string, Candle>();
    for (const candle of item?.history ?? EMPTY_CANDLES) if (typeof candle.time === "string" && valid(candle.value) && candle.value > 0) unique.set(candle.time, candle);
    return [...unique.values()].sort((a, b) => a.time.localeCompare(b.time));
  }, [item?.history]);
  const completedVolumes = candles.filter(point => point.isComplete !== false).slice(-20).flatMap(point => valid(point.volume) && point.volume >= 0 ? [point.volume] : []);
  const hasFinancials = Boolean(fundamentals && ([fundamentals.eps, fundamentals.revenue, fundamentals.epsGrowthPercent, fundamentals.revenueGrowthPercent].some(valid) || fundamentals.quarters?.length));
  const shownTab = tab === "financials" && !hasFinancials ? "overview" : tab;
  const quote = item ?? selectedRow;
  const currency = quote?.currency || "USD";
  const pages = Math.max(1, Math.ceil((universe.data?.matched || 0) / (universe.data?.pageSize || 50)));
  const displayedPage = universe.data?.page || page;
  const tabs: [Tab, string][] = [["overview", "개요"], ...(hasFinancials ? [["financials", "재무"] as [Tab, string]] : []), ["technicals", "기술"], ["news", "뉴스"], ...(item?.kind !== "etf" ? [["trading", "트레이딩"] as [Tab, string]] : [])];
  const choose = (nextSymbol: string) => { setSymbol(nextSymbol); setTab("overview"); };
  const refresh = () => { void universe.refetch(); if (selectedSymbol) void detail.refetch(); };
  const toggleFavorite = () => {
    if (!selectedSymbol) return;
    try {
      const saved = JSON.parse(localStorage.getItem("tm26_fincept_watchlist") || "[]");
      const current: string[] = Array.isArray(saved) ? saved.filter((value): value is string => typeof value === "string") : [];
      const removing = current.includes(selectedSymbol);
      const next = removing ? current.filter(value => value !== selectedSymbol) : [...new Set([...current, selectedSymbol])];
      localStorage.setItem("tm26_fincept_watchlist", JSON.stringify(next)); setFavorites(next);
      setActionNotice(`${selectedSymbol} 관심 ${removing ? "해제" : "저장"} 완료 · 이 브라우저에 보관됩니다.`);
    } catch { setActionNotice("관심 목록을 저장하지 못했습니다. 브라우저 저장 설정을 확인하세요."); }
  };
  const exportPage = () => {
    const cell = (value: unknown) => `"${(typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) ? "'" : "") + String(value ?? "").replace(/"/g, '""')}"`;
    const source = universe.data?.source;
    const rows = [["Symbol", "Name", "Market", ...(sectorMode ? ["Industry"] : []), "Observed price", "Currency", "Change (%)", "Volume", "Volume unit", "As of", "Source", "Source URL", "Status"], ...items.map(row => [row.symbol, row.name, market, ...(sectorMode ? [sectorLabel(row.sector)] : []), row.price, row.currency, row.changePercent, row.volume, "shares", row.asOf, sourceName(source), typeof source === "object" ? source.url : "", row.status || universe.data?.status])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `TM26-${market}-${sectorMode ? "sector-ETF" : assetClass === "etf" ? "ETF" : "equities"}-page-${displayedPage}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setActionNotice(`현재 페이지 ${items.length}개 종목의 CSV를 내보냈습니다.`);
  };

  return <div className={styles.root}>
    <header className={styles.heading}><div><h1>{sectorMode ? "섹터 ETF" : assetClass === "etf" ? "ETF 모니터" : "주식 모니터"}</h1><span>{sectorMode ? "KR · US INDUSTRIES" : assetClass === "etf" ? "ETF MONITOR" : "EQUITY MONITOR"}</span></div><button type="button" onClick={refresh} disabled={universe.isFetching || detail.isFetching}>{universe.isFetching || detail.isFetching ? "조회 중…" : "자료 새로고침"}</button></header>
    <div className={styles.searchbar}>
      <label>시장<select aria-label="조회 시장" value={market} onChange={event => { setMarket(event.target.value as "US" | "KR"); setInput(""); setSearch(""); setPage(1); setSymbol(""); setTab("overview"); setShowList(true); }}><option value="US">미국 · USD</option><option value="KR">한국 · KRW</option></select></label>
      {sectorMode ? <label>산업<select aria-label="산업 분류" value={sector} onChange={event => { setSector(event.target.value); setPage(1); setSymbol(""); setTab("overview"); setShowList(true); }}><option value="all">전체 산업 ({number(universe.data?.total)})</option>{universe.data?.sectorGroups?.map(group => <option key={group.id} value={group.id}>{group.label} ({number(group.count)})</option>)}</select></label> : null}
      <label>종목 검색<input type="search" value={input} onChange={event => { setInput(event.target.value); setShowList(true); }} maxLength={80} placeholder={`${marketName} 종목 코드 · ${assetClass === "etf" ? "ETF명" : "기업명"}`} /></label>
      <label>정렬<select value={sort} onChange={event => { setSort(event.target.value); setPage(1); setShowList(true); }}><option value="volume">거래량 순</option><option value="marketCap">시가총액 순</option><option value="turnover">거래대금 순</option><option value="symbol">종목코드 순</option><option value="up">상승률 순</option><option value="down">하락률 순</option></select></label>
      <button type="button" aria-expanded={showList} aria-controls={listId} onClick={() => setShowList(value => !value)}>종목 목록 {showList ? "접기" : "열기"}</button>
      <button type="button" onClick={exportPage} disabled={!items.length}>현재 페이지 CSV</button>
      <button type="button" onClick={toggleFavorite} disabled={!selectedSymbol} aria-pressed={favorites.includes(selectedSymbol)} aria-label={`${selectedSymbol || "선택 종목"} 관심 ${favorites.includes(selectedSymbol) ? "해제" : "저장"}`}>{favorites.includes(selectedSymbol) ? "★ 관심 해제" : "☆ 관심 저장"}</button>
      <span>{universe.data ? `${number(universe.data.total)}개 ${sectorMode ? "산업 ETF" : "관측 종목"} · 검색 ${number(universe.data.matched)}개` : `${marketName} 종목 조회`}</span>
    </div>
    
    {universe.isError ? <Retry text={universe.error.message} onRetry={() => { void universe.refetch(); }} fetching={universe.isFetching} /> : null}
    <section className={styles.universe} id={listId} hidden={!showList} aria-label={`${marketName} 종목 검색 결과`}>
      <div className={styles.universeHead}><span>{marketName} {sectorMode ? "산업별 ETF" : assetClass === "etf" ? "전체 ETF" : "전체 주식 · ETF 포함"}</span></div>
      {universe.isPending ? <div className={styles.empty} role="status">종목 목록을 불러오는 중…</div> : items.length ? <div className={styles.universeTable}><table><caption className={styles.srOnly}>{marketName} 종목 검색 결과. 기업명이나 행을 누르면 목록 아래에 종목 정보를 표시합니다.</caption><thead><tr><th scope="col">종목</th><th scope="col">{assetClass === "etf" ? "ETF명" : "기업명"}</th>{sectorMode ? <th scope="col">산업</th> : null}<th scope="col">관측 시세</th><th scope="col">등락률</th><th scope="col">거래량</th><th scope="col">시가총액</th><th scope="col">거래대금{market === "US" ? " (추정)" : ""}</th><th scope="col">기준</th></tr></thead><tbody>{items.map(row => <tr key={row.symbol} onClick={() => choose(row.symbol)} className={row.symbol === selectedSymbol ? styles.selected : undefined}><th scope="row"><button type="button" onClick={event => { event.stopPropagation(); choose(row.symbol); }} aria-pressed={row.symbol === selectedSymbol}>{row.symbol}</button></th><td><button type="button" className={styles.companyButton} onClick={event => { event.stopPropagation(); choose(row.symbol); }} aria-pressed={row.symbol === selectedSymbol}>{row.name || "이름 미제공"}</button></td>{sectorMode ? <td>{sectorLabel(row.sector)}</td> : null}<td>{unitValue(row.price, row.currency || "USD")}</td><td className={direction(row.changePercent)}>{change(row.changePercent)}</td><td>{number(row.volume)}</td><td>{unitValue(row.marketCap, row.currency, true)}</td><td>{unitValue(row.turnover, row.currency, true)}</td><td>{asOf(row.asOf)}</td></tr>)}</tbody></table></div> : !universe.isError ? <div className={styles.empty}>{search ? "검색 조건에 맞는 관측 종목이 없습니다." : "현재 제공된 종목 목록이 없습니다."}<button type="button" onClick={() => { setInput(""); setSearch(""); setPage(1); }}>검색 초기화</button></div> : null}
      <div className={styles.pagination}><button type="button" disabled={displayedPage <= 1 || universe.isFetching} onClick={() => setPage(Math.max(1, displayedPage - 1))}>이전</button><span>{displayedPage} / {pages} 페이지 · 페이지당 50개</span><button type="button" disabled={displayedPage >= pages || universe.isFetching} onClick={() => setPage(displayedPage + 1)}>다음</button></div>
      
    </section>
    {sort === "marketCap" && market === "US" ? <p className={styles.notice}>시가총액은 저장된 스크리닝 자료 기준이며, 미제공 종목은 마지막에 표시합니다.</p> : null}
    {sort === "turnover" && market === "US" ? <p className={styles.notice}>미국 거래대금은 일별 종가 × 거래량으로 계산한 추정치입니다.</p> : null}
    {quote ? <section className={styles.quote} aria-label="선택 종목 시세"><div className={styles.companyTitle}><span>{selectedSymbol}</span><h2>{item?.name || quote.name || selectedSymbol}</h2><small>{item?.profile?.exchange || item?.exchange || `${marketName} 시장`}{selectedRow?.sector ? ` · ${sectorMode ? "이름 기준 " : ""}${sectorLabel(selectedRow.sector)}` : ""}</small></div><div className={styles.quotePrice}><strong>{number(quote.price)} <small>{currency}</small></strong><span className={direction(quote.changePercent)}>{change(quote.changePercent)}{item && valid(item.change) ? ` (${item.change > 0 ? "+" : ""}${number(item.change)} ${currency})` : ""}</span></div><div className={styles.quoteStatus}><span>{statusText(item?.status || universe.data?.status)}</span><time>{asOf(quote.asOf)}</time></div></section> : <div className={styles.empty}>{universe.isPending ? `${marketName} 종목 정보를 확인하고 있습니다…` : "종목 목록에서 분석할 종목을 선택하세요."}</div>}
    {detail.isError ? <Retry text={detail.error.message} onRetry={() => { void detail.refetch(); }} fetching={detail.isFetching} /> : null}
    {detail.data?.errors?.length ? <div className={styles.notice} role="status">{detail.data.errors.join(" · ")}</div> : null}
    {item ? <>
      {item.yahooStatus==="stale"?<p className={styles.inlineWarning}>통계 갱신 실패 · 이전 자료</p>:null}
      <div className={styles.tabs} role="tablist" aria-label="주식분석 보기">{tabs.map(([value, label], index) => <button key={value} id={`${tabId}-${value}`} type="button" role="tab" aria-selected={shownTab === value} aria-controls={`${tabId}-panel`} tabIndex={shownTab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        setTab(tabs[next][0]); document.getElementById(`${tabId}-${tabs[next][0]}`)?.focus();
      }}>{label}</button>)}</div>
      <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${shownTab}`}>
        {shownTab === "financials" ? <Financials item={item} /> : shownTab === "technicals" ? <Technicals item={item} candles={candles} market={market} /> : shownTab === "news" ? <CompanyNews key={selectedSymbol} symbol={selectedSymbol} name={item.name || selectedRow.name} /> : shownTab === "trading" && item.kind !== "etf" ? <TradingScore symbol={selectedSymbol} market={market} /> : <div className={styles.overview}>
          <div className={styles.leftColumn}>
            <Panel title="최근 거래" code="TRADING"><Metrics rows={[
              { label: "관측 시세", value: unitValue(item.price, currency) }, { label: "전일 종가", value: unitValue(item.previousClose, currency) },
              { label: "시가", value: unitValue(item.open, currency) }, { label: "고가", value: unitValue(item.high, currency) }, { label: "저가", value: unitValue(item.low, currency) },
              { label: "거래량", value: unitValue(item.volume, "주", true) }, { label: "20일 평균거래량", value: unitValue(average(completedVolumes, 20), "주", true), note: "완료 일봉 기준" },
            ]} /></Panel>
            {item.kind !== "etf" ? <Panel title="가치평가" code="VALUATION"><Metrics rows={[
              { label: "시가총액", value: unitValue(item.marketCap ?? item.profile?.marketCap, currency, true) }, { label: "P/E", value: valid(fundamentals?.per)?`${number(fundamentals.per)}배`:"—" }, { label: "P/B", value: valid(fundamentals?.pbr)?`${number(fundamentals.pbr)}배`:"—" }, {label:"배당수익률",value:percent(fundamentals?.dividendYieldPercent)}, { label: "기업가치 / EBITDA", value: valid(fundamentals?.enterpriseToEbitda)?`${number(fundamentals.enterpriseToEbitda)}배`:"—" },
            ]} />{!valid(fundamentals?.per)&&!valid(fundamentals?.pbr)?<p className={styles.panelNote}>평가배수 자료 미제공</p>:null }</Panel> : null}
            {item.kind !== "etf" ? <Panel title="주식 정보" code="SHARE STATISTICS"><Metrics rows={[
              { label: "발행주식수", value: unitValue(item.profile?.sharesOutstanding, "주", true) }, { label: "유동주식수", value: unitValue(item.profile?.floatShares,"주",true) }, { label: "거래소", value: item.profile?.exchange || item.exchange || "—" }, { label: "가격 단위", value: currency },
            ]} /></Panel> : null}
          </div>
          <div className={styles.centerColumn}>
            <Panel title="가격·거래량" code={`${currency} · DAILY OHLC`}><PriceHistory key={item.symbol} candles={candles} currency={currency} symbol={item.symbol} historyStatus={item.historyStatus} /></Panel>
            {item.kind !== "etf" ? <Panel title="최근 실적" code="FINANCIAL SNAPSHOT"><div className={styles.snapshot}><div><span>매출</span><strong>{unitValue(fundamentals?.revenue, fundamentals?.revenueUnit || item.currency, true)}</strong><small>전년 대비 <b className={direction(fundamentals?.revenueGrowthPercent)}>{percent(fundamentals?.revenueGrowthPercent)}</b></small></div><div><span>EPS</span><strong>{unitValue(fundamentals?.eps, `${item.currency}/주`)}</strong></div><div><span>실적 기준</span><strong className={styles.snapshotDate}>{fundamentals?.financialPeriod?.replace(/\s*(?:미국|한국) 스크리닝/g, "") || (fundamentals?.snapshotAsOf ? asOf(fundamentals.snapshotAsOf) : "—")}</strong></div></div></Panel> : null}
            {item.etf?<Panel title="ETF 정보" code="FUND PROFILE"><Metrics rows={[
              {label:"운용사",value:item.etf.issuer||"—"},{label:"기초지수",value:item.etf.underlyingIndex||"—"},
              {label:"순자산가치 (NAV)",value:unitValue(item.etf.nav,currency)},{label:"순자산 총액",value:unitValue(item.etf.totalAssets,currency,true)},
              {label:"총보수",value:percent(item.etf.expenseRatioPercent)},{label:"1개월 수익률",value:percent(item.etf.return1mPercent)},
              {label:"3개월 수익률",value:percent(item.etf.return3mPercent)},{label:"1년 수익률",value:percent(item.etf.return1yPercent)},
            ]}/></Panel>:null}
            <Panel title={item.kind === "etf" ? "펀드 개요" : "기업 정보"} code={item.kind === "etf" ? "FUND OVERVIEW" : "COMPANY PROFILE"}><div className={styles.profile}><p>{description(item.profile?.description)}</p><Metrics rows={item.kind === "etf" ? [{label:"산업",value:sectorMode ? sectorLabel(selectedRow?.sector) : item.profile?.industry || "—"}] : [{ label: "산업", value: item.profile?.industry || selectedRow?.sector || "—" }, { label: "직원 수", value: valid(item.profile?.employees) ? `${number(item.profile.employees)}명` : "—" }]} />{safeUrl(item.profile?.website) ? <a href={safeUrl(item.profile?.website)} target="_blank" rel="noopener noreferrer">기업 웹사이트 ↗</a> : null}</div></Panel>
          </div>
          <div className={styles.rightColumn}>
            {item.kind !== "etf" ? <Panel title="분석가 목표가" code="ANALYST TARGETS"><Metrics rows={[{ label: "평균 목표가", value: unitValue(item.consensus?.mean,currency) }, { label: "목표가 최고 / 최저", value: valid(item.consensus?.high)&&valid(item.consensus?.low)?`${number(item.consensus.high)} / ${number(item.consensus.low)} ${currency}`:"—" }, { label: "의견 수", value: number(item.consensus?.count) }]} />{valid(item.consensus?.mean)?null:<p className={styles.panelNote}>분석가 컨센서스 자료가 없습니다.</p>}</Panel> : null}
            <RangePanel item={item} candles={candles} />
            {item.kind !== "etf" ? <Panel title="수익성" code="PROFITABILITY"><Metrics rows={[{ label: "순이익률", value: percent(fundamentals?.netMarginPercent) }, { label: "영업이익률", value: percent(fundamentals?.operatingMarginPercent) }, { label: "ROE", value: percent(fundamentals?.roePercent) }]} />{[fundamentals?.netMarginPercent,fundamentals?.operatingMarginPercent,fundamentals?.roePercent].some(valid)?<></>:<p className={styles.panelNote}>해당 수익성 비율이 제공되지 않습니다.</p>}</Panel> : null}
            {item.kind !== "etf" ? <Panel title="실적 성장" code="GROWTH"><Metrics rows={[
              { label: "매출 YoY", value: percent(fundamentals?.revenueGrowthPercent), tone: direction(fundamentals?.revenueGrowthPercent) },
              { label: fundamentals?.epsBasis === "순이익" ? "순이익 YoY (대체)" : "EPS YoY", value: percent(fundamentals?.epsGrowthPercent), tone: direction(fundamentals?.epsGrowthPercent) },
            ]} /></Panel> : null}
          </div>
        </div>}
      </div>
      <footer className={styles.footer}><div><button type="button" onClick={() => onNavigate("research")}>리서치 보고서</button><button type="button" onClick={() => onNavigate("calls")}>컨퍼런스콜</button></div></footer>
    </> : selectedSymbol && detail.isPending ? <div className={styles.empty} role="status">{selectedSymbol}의 가격 이력과 기업 자료를 불러오고 있습니다…</div> : selectedSymbol && !detail.isError ? <div className={styles.empty}>이 종목의 상세 자료가 제공되지 않습니다.<button type="button" onClick={() => { void detail.refetch(); }}>다시 조회</button></div> : null}
  </div>;
}

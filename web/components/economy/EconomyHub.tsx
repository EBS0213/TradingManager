"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, LineChart as ChartIcon, RefreshCw, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  EconomySeries, economyCountry, economyCsv,
  economyFrequency, economyNumber, economyQueryOptions, selectEconomyHighlights,
} from "./types";
import styles from "./EconomyHub.module.css";
import IndustryPrices from "./IndustryPrices";

export type HubTab = "overview" | "rates" | "markets" | "dram" | "oil";
type EconomyHubProps = { initialTab?: HubTab; initialSeries?: string };
const TABS: { id: HubTab; name: string; code: string }[] = [
  {id:"overview",name:"경제 지표",code:"01"}, {id:"dram",name:"DRAM",code:"02"},
  {id:"oil",name:"국제 원유·석유제품",code:"03"}, {id:"rates",name:"금리·채권",code:"04"},
  {id:"markets",name:"환율·원자재",code:"05"},
];
const EMPTY_SERIES: EconomySeries[] = [];
const STATUS_LABEL = { available: "제공 중", stale: "이전 자료", unavailable: "미제공" };
const SERIES_RANK = { available: 0, stale: 1, unavailable: 2 };

function SeriesStatus({ series }: { series: EconomySeries }) {
  return <span className={`eco-status eco-status-${series.status}`}>{STATUS_LABEL[series.status] || "상태 미제공"}</span>;
}

function SeriesCard({ series, active, onClick }: { series: EconomySeries; active: boolean; onClick: () => void }) {
  return <button type="button" className={`eco-metric ${active ? "is-active" : ""}`} onClick={onClick} aria-pressed={active}>
    <span className="eco-metric-top"><span>{series.name}</span><SeriesStatus series={series} /></span>
    <strong>{economyNumber(series.value, true)} <small>{series.unit}</small></strong>
    <span className="eco-metric-bottom"><span>{economyCountry(series.country)} · {economyFrequency(series.frequency)}</span><span>기준 {series.asOf || "—"}</span></span>
  </button>;
}

function IndicatorTable({ series, selected, onSelect }: { series: EconomySeries[]; selected?: EconomySeries; onSelect: (series: EconomySeries) => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | EconomySeries["status"]>("all");
  const [sort, setSort] = useState<"availability" | "name" | "date">("availability");
  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return series.filter(item => (status === "all" || item.status === status)
      && (!term || `${item.name} ${item.id} ${item.country} ${economyCountry(item.country)} ${item.source.name}`.toLocaleLowerCase().includes(term)))
      .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "ko")
        : sort === "date" ? (b.asOf || "").localeCompare(a.asOf || "") || SERIES_RANK[a.status] - SERIES_RANK[b.status]
        : Number(a.value === null) - Number(b.value === null) || SERIES_RANK[a.status] - SERIES_RANK[b.status] || a.name.localeCompare(b.name, "ko"));
  }, [series, search, status, sort]);
  const counts = series.reduce((sum, item) => { sum[item.status]++; return sum; }, { available: 0, stale: 0, unavailable: 0 });
  return <section className={`eco-panel ${styles.inventory}`} aria-label="경제 지표 탐색">
    <div className={styles.toolbar}>
      <div><h2>지표 탐색 <span>{rows.length} / {series.length}</span></h2></div>
      <label className={styles.search}>검색<input type="search" aria-label="경제 지표 검색" value={search} onChange={event => setSearch(event.target.value)} placeholder="지표 · 코드 · 국가" /></label>
      <label>상태<select aria-label="경제 지표 상태" value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">전체 ({series.length})</option>{(Object.keys(STATUS_LABEL) as EconomySeries["status"][]).map(value => <option key={value} value={value}>{STATUS_LABEL[value]} ({counts[value]})</option>)}</select></label>
      <label>정렬<select aria-label="경제 지표 정렬" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="availability">값 있는 자료 우선</option><option value="name">지표명</option><option value="date">최근 기준일</option></select></label>
    </div>
    <div className={styles.tableScroll} tabIndex={0} aria-label="경제 지표 목록, 가로로 스크롤할 수 있습니다">
      <table className={styles.indicatorTable}>
        <caption className={styles.srOnly}>경제 지표별 최근값, 직전 관측 대비 변화, 기준일, 출처와 제공 상태</caption>
        <thead><tr>{["지표", "국가", "최근값", "변화", "기준일", "상태"].map(label => <th scope="col" key={label} >{label}</th>)}</tr></thead>
        <tbody>{rows.map(item => <tr key={`${item.country}:${item.id}`} className={item === selected ? styles.selectedRow : undefined}>
          <th scope="row"><button type="button" aria-pressed={item === selected} onClick={() => onSelect(item)}>{item.name}<small>{item.id}</small></button></th>
          <td>{economyCountry(item.country)}<small>{item.country}</small></td>
          <td className={styles.numeric}>{economyNumber(item.value)}<small>{item.unit}</small></td>
          <td className={styles.numeric}>{typeof item.change === "number" && item.change > 0 ? "+" : ""}{economyNumber(item.change)}<small>{item.change === null ? "직전 비교 불가" : item.unit === "%" ? "%p" : item.unit}</small></td>
          <td>{item.asOf || "—"}<small>{economyFrequency(item.frequency)}</small></td>
          
          <td><SeriesStatus series={item} /></td>
        </tr>)}</tbody>
      </table>
      {!rows.length ? <div className="eco-empty" role="status"><p>검색 조건에 맞는 지표가 없습니다.</p><button type="button" className="eco-button" onClick={() => { setSearch(""); setStatus("all"); }}>검색·필터 초기화</button></div> : null}
    </div>
    
  </section>;
}

function buildChartRows(series: EconomySeries[]) {
  const byDate = new Map<string, Record<string, string | number | null>>();
  for (let index = 0; index < series.length; index++) {
    for (const point of series[index].points) {
      const row = byDate.get(point.date) || { date: point.date, value0: null, value1: null };
      row[`value${index}`] = typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null;
      byDate.set(point.date, row);
    }
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function SeriesExplorer({ series, comparison, comparisonRequested }: { series: EconomySeries; comparison?: EconomySeries; comparisonRequested: boolean }) {
  const [display, setDisplay] = useState<"chart" | "table">("chart");
  const items = useMemo(() => comparison ? [series, comparison] : [series], [series, comparison]);
  const rows = useMemo(() => buildChartRows(items), [items]);
  const hasPoints = rows.some((row) => typeof row.value0 === "number" || typeof row.value1 === "number");
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([economyCsv(items)], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `tm26-economy-${series.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-${series.country}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="eco-panel eco-explorer" aria-label={`${series.name} 추이`}>
    <header className="eco-panel-heading">
      <div><span className="eco-eyebrow">INDICATOR DETAIL</span><h2>{series.name}</h2><p>{series.unit} · {economyFrequency(series.frequency)} · 관측값 기준</p></div>
      <div className="eco-actions">
        <div className="eco-segment" aria-label="표시 방식">
          <button type="button" onClick={() => setDisplay("chart")} aria-pressed={display === "chart"}><ChartIcon size={13} /> 차트</button>
          <button type="button" onClick={() => setDisplay("table")} aria-pressed={display === "table"}><Table2 size={13} /> 표</button>
        </div>
        <button type="button" className="eco-button" onClick={exportCsv} disabled={!hasPoints}><Download size={13} /> CSV</button>
      </div>
    </header>
    <div className="eco-detail-metrics">{items.map((item, index) => <div key={`${item.country}:${item.id}`} className={index ? "eco-comparison" : ""}>
      <span>{economyCountry(item.country)} <SeriesStatus series={item} /></span>
      <strong>{economyNumber(item.value)} <small>{item.unit}</small></strong>
      <span>직전 관측 {economyNumber(item.previous)} · 변화 {typeof item.change === "number" && item.change > 0 ? "+" : ""}{economyNumber(item.change)}</span>
      <span>기준 {item.asOf || "—"} · {economyFrequency(item.frequency)}</span>
    </div>)}</div>
    {items.some((item) => item.status === "stale") ? <div className="eco-alert">일부 지표는 이전에 확보한 자료입니다. 기준일을 확인해 주세요.</div> : null}
    {comparisonRequested && !comparison ? <p className="eco-inline-note">비교 자료 없음</p> : null}
    {!hasPoints ? <div className="eco-empty">이 지표의 기간별 관측 자료가 없습니다.</div> : display === "chart" ? <div className="eco-chart" role="img" aria-label={`${series.name} ${economyFrequency(series.frequency)} 추이. 자세한 값은 표에서 확인할 수 있습니다.`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 16, right: 24, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="#292b30" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#92959e", fontSize: 10 }} minTickGap={36} axisLine={{ stroke: "#34363d" }} tickLine={false} />
          <YAxis tick={{ fill: "#92959e", fontSize: 10 }} width={66} tickFormatter={(value: number) => economyNumber(value, true)} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
          <Tooltip contentStyle={{ background: "#15171c", border: "1px solid #45403a", borderRadius: 0, fontSize: 11 }} labelStyle={{ color: "#bbb" }} formatter={(value) => [`${economyNumber(typeof value === "number" ? value : null)} ${series.unit}`]} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
          {items.map((item, index) => <Line key={`${item.country}:${item.id}`} dataKey={`value${index}`} name={economyCountry(item.country)} stroke={index ? "#6db4da" : "#ffad33"} strokeWidth={2} dot={rows.length < 3} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div> : <div className="eco-table-scroll"><table className="eco-table"><caption>{series.name} · {series.unit} · {economyFrequency(series.frequency)}</caption><thead><tr><th scope="col">기준일</th>{items.map((item) => <th scope="col" key={`${item.country}:${item.id}`}>{economyCountry(item.country)}</th>)}</tr></thead><tbody>{[...rows].reverse().map((row) => <tr key={String(row.date)}><th scope="row">{row.date}</th>{items.map((item, index) => <td key={`${item.country}:${item.id}`}>{economyNumber(typeof row[`value${index}`] === "number" ? row[`value${index}`] as number : null)}</td>)}</tr>)}</tbody></table></div>}
    
  </section>;
}

export function EconomyHub({ initialTab = "overview", initialSeries = "" }: EconomyHubProps = {}) {
  const [tab, setTab] = useState<HubTab>(initialTab);
  const [selectedKey, setSelectedKey] = useState(initialSeries);
  const prices = tab === "dram" || tab === "oil";
  const overview = useQuery({...economyQueryOptions("overview"),enabled:!prices});
  const allSeries = overview.data?.series || EMPTY_SERIES;
  const visibleSeries = allSeries.filter(item => tab === "rates" ? item.category === "rates" : tab === "markets" ? item.category === "fx" || item.category === "commodities" : true)
    .sort((a,b)=>SERIES_RANK[a.status]-SERIES_RANK[b.status]);
  const highlights = tab === "overview" ? selectEconomyHighlights(visibleSeries) : visibleSeries.slice(0,6);
  const selected = visibleSeries.find(item=>`${item.country}:${item.id}`===selectedKey||item.id===selectedKey)||highlights[0]||visibleSeries[0];
  const staleCount = visibleSeries.filter(item=>item.status==="stale").length;
  const unavailableCount = visibleSeries.filter(item=>item.status==="unavailable").length;
  return <div className={`tm-economy eco-hub ${styles.workbench}`} role="region" aria-label="데이터 분석">
    <header className="eco-hub-header"><div><span className="eco-eyebrow">TM26 / DATA</span><h1>데이터</h1></div>{!prices?<button type="button" className="eco-button" onClick={()=>void overview.refetch()} disabled={overview.isFetching}><RefreshCw size={13}/>{overview.isFetching?"조회 중":"새로고침"}</button>:null}</header>
    <nav className="eco-tabs" aria-label="데이터 분류">{TABS.map(item=><button type="button" key={item.id} aria-pressed={tab===item.id} onClick={()=>setTab(item.id)}><span>{item.code}</span>{item.name}</button>)}</nav>
    {prices?<IndustryPrices key={tab} view={tab === "dram" ? "dram" : "oil"}/>:<>
      <div className="eco-meta"><span>전체 {visibleSeries.length} · 제공 {visibleSeries.length-staleCount-unavailableCount} · 이전 자료 {staleCount} · 미제공 {unavailableCount}</span></div>
      {overview.isError?<div className="eco-alert" role="alert">경제 데이터를 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.</div>:null}
      {overview.data?.errors.length?<div className="eco-alert" role="status">일부 지표 조회 실패</div>:null}
      {overview.isPending?<div className="eco-loading" role="status">경제 데이터를 불러오는 중입니다.</div>:visibleSeries.length?<>
        <section className="eco-metric-grid" aria-label="주요 경제 지표">{highlights.map(item=><SeriesCard key={`${item.country}:${item.id}`} series={item} active={selected===item} onClick={()=>setSelectedKey(`${item.country}:${item.id}`)}/>)}</section>
        <IndicatorTable key={tab} series={visibleSeries} selected={selected} onSelect={item=>setSelectedKey(`${item.country}:${item.id}`)}/>
        {selected?<SeriesExplorer series={selected} comparisonRequested={false}/>:null}
      </>:<p className="eco-empty">현재 제공되는 지표가 없습니다.</p>}
    </>}
  </div>;
}
export default EconomyHub;

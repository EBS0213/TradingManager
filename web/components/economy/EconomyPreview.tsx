"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { economyFrequency, economyNumber, economyQueryOptions, selectEconomyHighlights } from "./types";

export function EconomyPreview({ onOpen }: { onOpen: () => void }) {
  const query = useQuery(economyQueryOptions("overview"));
  const series = selectEconomyHighlights(query.data?.series || []);
  return (
    <section className="tm-economy tm-economy-preview" aria-label="경제 데이터 미리보기">
      <header className="eco-preview-heading">
        <div><span className="eco-eyebrow">ECONOMIC MONITOR</span><h2>경제 데이터</h2></div>
        <button type="button" className="eco-button eco-button-accent" onClick={onOpen}>경제 허브 열기 <ArrowUpRight size={13} /></button>
      </header>
      {query.isPending ? <div className="eco-empty" role="status">경제 지표를 불러오는 중입니다…</div> : null}
      {query.isError ? <div className="eco-alert" role="alert">경제 지표를 불러오지 못했습니다. <button type="button" className="eco-button" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={12} /> 다시 시도</button></div> : null}
      {series.length ? <div className="eco-preview-grid">{series.map((item) => <button type="button" className="eco-preview-item" key={`${item.country}:${item.id}`} onClick={onOpen}>
        <span className="eco-series-name">{item.name}</span>
        <strong>{economyNumber(item.value, true)} <small>{item.unit}</small></strong>
        <span className="eco-muted">{economyFrequency(item.frequency)} · 기준 {item.asOf || "—"}</span>
        {item.status !== "available" ? <span className={`eco-status eco-status-${item.status}`}>{item.status === "stale" ? "이전 자료" : "미제공"}</span> : null}
      </button>)}</div> : !query.isPending && !query.isError ? <div className="eco-empty">현재 제공되는 경제 지표가 없습니다.</div> : null}
      
    </section>
  );
}

export default EconomyPreview;

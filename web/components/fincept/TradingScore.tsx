"use client";

import { useQuery } from "@tanstack/react-query";
import styles from "./TradingScore.module.css";

type Market = "KR" | "US";
type ScoreRow = Record<string, unknown>;
type ScoreResponse = { ok: boolean; market: Market; symbol: string; stamp: string | null; row: ScoreRow | null };
const labels: Record<Market, string[]> = {
  KR: ["EPS 성장", "매출 성장", "수급", "52주 고점 근접", "추세 지속", "일중 변동", "10일 가격 범위", "20일 고가 근접", "거래량 마름"],
  US: ["EPS 성장", "매출 성장", "52주 고점 근접", "가격 수축 VCP", "추세 지속", "일중 변동", "10일 가격 범위", "20일 고가 근접", "거래량 마름"],
};
const maximums: Record<Market, number[]> = {
  KR: [16, 14, 6, 12, 12, 12, 12, 8, 8],
  US: [16, 14, 14, 14, 4, 14, 10, 6, 8],
};
function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function breakdown(value: unknown): number[] {
  try {
    const values = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(values) && values.length === 9 && values.every(part => numeric(part) !== null) ? values.map(part => Number(part)) : [];
  } catch { return []; }
}

export default function TradingScore({ symbol, market }: { symbol: string; market: Market }) {
  const result = useQuery({
    queryKey: ["fincept", "trading-score", market, symbol],
    queryFn: async ({ signal }): Promise<ScoreResponse> => {
      const response = await fetch(`/api/screener/latest?${new URLSearchParams({ market, symbol })}`, { signal });
      if (!response.ok) throw new Error(`점수 조회 실패 (${response.status})`);
      return response.json();
    },
    staleTime: 60_000, retry: 1, refetchOnWindowFocus: false,
  });
  const row = result.data?.row;
  const score = row ? numeric(row["종합점수"]) : null;
  const parts = row ? breakdown(row["점수내역"]) : [];
  const penalty = row ? numeric(row["감점"]) : null;
  return <section className={styles.root} aria-label={`${symbol} 트레이딩 점수`}>
    <header className={styles.header}><div><h2>트레이딩 점수</h2><span>최신 스크리닝 회차 · {result.data?.stamp || "기준일 미제공"}</span></div><button type="button" onClick={() => { void result.refetch(); }} disabled={result.isFetching}>{result.isFetching ? "조회 중…" : "새로고침"}</button></header>
    {result.isPending ? <p className={styles.empty} role="status">종목 점수를 불러오고 있습니다…</p> : result.isError ? <p className={styles.empty} role="alert">{result.error.message} <button type="button" onClick={() => { void result.refetch(); }}>다시 조회</button></p> : !row ? <p className={styles.empty}>이 종목은 최신 스크리닝 결과에 없습니다. 점수를 임의로 계산해 표시하지 않습니다.</p> : <>
      {text(row["제외사유"]) ? <p className={styles.notice}>{text(row["제외사유"])}</p> : null}
      {text(row["부적합사유"]) ? <p className={styles.notice}>트레이딩 부적합: {text(row["부적합사유"])}</p> : null}
      <div className={styles.summary}><div className={styles.total}><span>종합점수</span><strong data-grade={score === null ? "none" : score >= 80 ? "top" : score >= 70 ? "good" : score >= 60 ? "mid" : "low"}>{score === null ? "—" : Math.round(score)}<small>/100</small></strong></div><dl>
        <div><dt>추세 조건</dt><dd>{numeric(row["통과개수"]) === null || text(row["제외사유"]) ? "미판정" : `${numeric(row["통과개수"])}/8`}</dd></div>
        <div><dt>RS 순위</dt><dd>{numeric(row["RS"]) ?? "—"}</dd></div>
        <div><dt>편입 상태</dt><dd>{text(row["편입상태"]) || "—"}</dd></div>
        <div><dt>조건 유지</dt><dd>{numeric(row["잔류일"]) === null ? "—" : `${numeric(row["잔류일"])}일`}</dd></div>
        <div><dt>실적 판정</dt><dd>{text(row["실적판정"]) || "—"}</dd></div>
        <div><dt>스크리닝</dt><dd>{text(row["판정"]) || "—"}</dd></div>
      </dl></div>
      {parts.length ? <div className={styles.parts}><h3>항목별 점수</h3><div className={styles.partGrid}>{parts.map((value, index) => <div key={`${market}-${index}`} className={styles.part}><span>{labels[market][index]}</span><div className={styles.bar}><i style={{ width: `${Math.max(0, Math.min(100, value / maximums[market][index] * 100))}%` }} /></div><b>{value.toFixed(1)} / {maximums[market][index]}</b></div>)}</div>{penalty && penalty > 0 ? <p className={styles.penalty}>감점 −{penalty}점{text(row["감점사유"]) ? ` · ${text(row["감점사유"])}` : ""}</p> : null}</div> : <p className={styles.empty}>이 회차의 항목별 점수는 제공되지 않습니다.</p>}
      
    </>}
  </section>;
}

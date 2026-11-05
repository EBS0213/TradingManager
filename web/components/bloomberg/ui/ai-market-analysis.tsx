"use client";
import type { MarketItem } from "../types";
import { bloombergColors } from "../lib/theme-config";
import { TerminalAnalysisPanel } from "./terminal-analysis-panel";
export function AiMarketAnalysis({ selectedSecurity, benchmarkSecurity, colors }: { selectedSecurity?: MarketItem; benchmarkSecurity?: MarketItem; colors: typeof bloombergColors.dark }) {
  return <TerminalAnalysisPanel key={`${selectedSecurity?.id}-${benchmarkSecurity?.id}`} marketData={{ selectedSecurity, benchmarkSecurity }} colors={colors} overviewLabel="REFRESH" prompt={`${selectedSecurity?.id || "선택 종목"}와 ${benchmarkSecurity?.id || "벤치마크"}의 관측 수치를 비교해 주세요.`} />;
}

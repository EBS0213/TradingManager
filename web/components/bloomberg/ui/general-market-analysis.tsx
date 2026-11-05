"use client";
import type { MarketData } from "../types";
import { bloombergColors } from "../lib/theme-config";
import { TerminalAnalysisPanel } from "./terminal-analysis-panel";
export function GeneralMarketAnalysis({ marketData, colors }: { marketData: MarketData; colors: typeof bloombergColors.dark }) {
  return <TerminalAnalysisPanel marketData={{ fullMarketData: marketData }} colors={colors} prompt="관측 데이터에 기반해 주요 시장의 상승·하락과 현재 시장 상태를 요약해 주세요." />;
}

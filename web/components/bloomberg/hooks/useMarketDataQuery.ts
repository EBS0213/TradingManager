"use client";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { fetchMarketData } from "../api/market-data";
import { isRealTimeEnabledAtom } from "../atoms";
import type { MarketData } from "../types";
export const MARKET_DATA_KEY = "terminal-market-data";
export function useMarketDataQuery() {
  const [isRealTimeEnabled, setIsRealTimeEnabled] = useAtom(isRealTimeEnabledAtom);
  const previous = useRef<MarketData | undefined>(undefined);
  const query = useQuery({ queryKey: [MARKET_DATA_KEY], queryFn: fetchMarketData,
    refetchInterval: isRealTimeEnabled ? 30000 : false, staleTime: 30000,
    refetchOnWindowFocus: false, gcTime: 3600000, retry: 1 });
  const marketData = query.data;
  const updatedCells: Record<string, boolean> = {};
  const updatedSparklines: Record<string, boolean> = {};
  if (marketData && previous.current && marketData !== previous.current) {
    for (const region of ["americas", "emea", "asiaPacific"] as const) {
      for (const item of marketData[region]) {
        const old = previous.current[region].find((candidate) => candidate.id === item.id);
        if (!old) continue;
        for (const field of ["value", "change", "pctChange", "avat", "time", "ytd", "ytdCur"] as const) {
          if (!Object.is(old[field], item[field])) updatedCells[`${region}-${item.id}-${field}`] = true;
        }
        if (JSON.stringify(old.sparkline1) !== JSON.stringify(item.sparkline1)) updatedSparklines[`${region}-${item.id}-sparkline`] = true;
      }
    }
  }
  useEffect(() => { previous.current = marketData; }, [marketData]);
  const rawUpdated = typeof marketData?.lastUpdated === "string" ? new Date(marketData.lastUpdated) : null;
  const lastUpdated = rawUpdated && Number.isFinite(rawUpdated.getTime()) ? rawUpdated : null;
  const toggleRealTimeUpdates = useCallback(() => setIsRealTimeEnabled((value) => !value), [setIsRealTimeEnabled]);
  const refreshData = useCallback(() => query.refetch(), [query.refetch]);
  return { marketData, isLoading: query.isLoading, isFetching: query.isFetching, error: query.error,
    lastUpdated, dataUpdatedAt: new Date(query.dataUpdatedAt), updatedCells, updatedSparklines,
    isRealTimeEnabled, dataSource: typeof marketData?.dataSource === "string" ? marketData.dataSource : typeof marketData?.source === "string" ? marketData.source : "unavailable",
    isFromRedis: marketData?.isFromRedis === true || marketData?.fromRedis === true,
    toggleRealTimeUpdates, refreshData };
}

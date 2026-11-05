// API functions for fetching market data

/**
 * Fetches market data from the API
 */
export async function fetchMarketData(): Promise<MarketData> {
  const response = await fetch("/api/terminal/market-data", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch market data: ${response.status}`);
  const data = await response.json();
  for (const region of ["americas", "emea", "asiaPacific"]) {
    data[region] = (Array.isArray(data[region]) ? data[region] : []).map((item: MarketItem) => {
      const normalized = { ...item };
      for (const field of ["value", "change", "pctChange", "avat", "ytd", "ytdCur"] as const) {
        normalized[field] = typeof item[field] === "number" && Number.isFinite(item[field]) ? item[field] : Number.NaN;
      }
      normalized.sparkline1 = Array.isArray(item.sparkline1) ? item.sparkline1.filter(Number.isFinite) : [];
      normalized.sparkline2 = Array.isArray(item.sparkline2) ? item.sparkline2.filter(Number.isFinite) : [];
      return normalized;
    });
  }
  return data;
}

import type { MarketData, MarketItem } from "../types";

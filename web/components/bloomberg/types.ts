// Define proper types for market data
export type MarketItem = {
  id: string;
  history?: Array<{ time: string; value: number }>;
  dailyHistory?: Array<{ time: string; value: number; open?: number; high?: number; low?: number; close?: number; volume?: number; isComplete?: boolean | null }>;
  dailyHistoryGranularity?: "day";
  dailyHistoryStatus?: "delayed" | "stale" | "unavailable";
  dailyHistoryAsOf?: string;
  source?: string;
  dataStatus?: string;
  asOf?: string;
  currency?: string;
  isFuture?: boolean;
  peRatio?: number;
  num?: string;
  rmi?: string;
  value: number;
  change: number;
  pctChange: number;
  avat: number;
  time: string;
  ytd: number;
  ytdCur: number;
  sparkline1?: number[];
  sparkline2?: number[];
  sparklineUpdated?: string;
  lastUpdated?: string;
  // Additional properties for filters
  historicalData10D?: number[];
  volatility?: number;
  isMover?: boolean;
};

export type MarketData = {
  americas: MarketItem[];
  emea: MarketItem[];
  asiaPacific: MarketItem[];
  lastUpdated?: string;
  lastSparklineUpdate?: string;
  isFromRedis?: boolean;
  dataSource?: string;
  [key: string]: MarketItem[] | string | boolean | undefined; // Type-safe index signature for dynamic access
};

export interface FilterState {
  showMovers: boolean;
  showVolatility: boolean;
  showRatios: boolean;
  showFutures: boolean;
  showAvat: boolean;
  show10D: boolean;
  showYTD: boolean;
  showCAD: boolean;
}

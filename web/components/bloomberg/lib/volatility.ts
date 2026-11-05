import type { MarketItem } from "../types";

type Observation = { time: string; value: number; timestamp: number };
export type VolatilityMetrics = {
  observations: number;
  returns: number;
  interval: "daily" | "intraday" | "irregular" | "insufficient";
  intervalLabel: string;
  intervalMinutes: number | null;
  standardDeviationPct: number | null;
  annualizedVolatilityPct: number | null;
  impliedVolatilityPct: null;
  rsi14: number | null;
  lastObservedDayRangePct: number | null;
  observedRangePct: number | null;
  trend: "up" | "down" | "stable" | null;
  firstObserved: string | null;
  lastObserved: string | null;
  values: number[];
  historySource: "daily" | "intraday";
  rangeSource: "daily-ohlc" | "observed-price" | "unavailable";
};

function sampleDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function observedRange(values: number[]): number | null {
  if (values.length < 2) return null;
  const low = Math.min(...values), high = Math.max(...values);
  return (high / low - 1) * 100;
}

/** Wilder RSI of 14 observed price changes, never labelled a 14-day RSI for minute data. */
function wilderRsi(values: number[]): number | null {
  if (values.length < 15) return null;
  const changes = values.slice(1).map((value, index) => value - values[index]);
  let gain = changes.slice(0, 14).reduce((sum, value) => sum + Math.max(value, 0), 0) / 14;
  let loss = changes.slice(0, 14).reduce((sum, value) => sum + Math.max(-value, 0), 0) / 14;
  for (const change of changes.slice(14)) {
    gain = (gain * 13 + Math.max(change, 0)) / 14;
    loss = (loss * 13 + Math.max(-change, 0)) / 14;
  }
  if (!gain && !loss) return 50;
  if (!loss) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Metrics from observed timestamped prices only. No price or IV simulation. */
export function calculateVolatilityMetrics(item: Pick<MarketItem, "history" | "dailyHistory">): VolatilityMetrics {
  const daily = (item.dailyHistory || []).filter((point) => point.isComplete !== false && Number.isFinite(Date.parse(point.time)) && Number.isFinite(point.value) && point.value > 0);
  const historySource = daily.length >= 3 ? "daily" : "intraday";
  const unique = new Map<number, Observation>();
  for (const point of (historySource === "daily" ? daily : item.history || []).slice(-5000)) {
    const timestamp = Date.parse(point.time);
    if (!Number.isFinite(timestamp) || !Number.isFinite(point.value) || point.value <= 0) continue;
    unique.set(timestamp, { ...point, timestamp });
  }
  const points = [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
  const values = points.map((point) => point.value);
  const gaps = points.slice(1).map((point, index) => (point.timestamp - points[index].timestamp) / 60000);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const middle = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : null;
  const uniqueDays = new Set(points.map((point) => new Date(point.timestamp).toISOString().slice(0, 10))).size;
  let interval: VolatilityMetrics["interval"] = "insufficient";
  if (points.length >= 3 && middle !== null) {
    if (uniqueDays === points.length && Math.min(...gaps) >= 18 * 60 && middle <= 36 * 60 && Math.max(...gaps) <= 7 * 24 * 60) {
      interval = "daily";
    } else if (middle > 0 && middle <= 60 && gaps.filter((gap) => Math.abs(gap - middle) <= middle * 0.1).length / gaps.length >= 0.8) {
      interval = "intraday";
    } else {
      interval = "irregular";
    }
  }
  // Exclude overnight/long gaps from a regular minute-interval volatility estimate.
  const logReturns = points.slice(1).flatMap((point, index) => interval === "intraday" && middle !== null && Math.abs(gaps[index] - middle) > middle * 0.1 ? [] : [Math.log(point.value / points[index].value)]);
  const deviation = sampleDeviation(logReturns);
  const split = Math.floor(logReturns.length / 2);
  const firstDeviation = logReturns.length >= 20 ? sampleDeviation(logReturns.slice(0, split)) : null;
  const lastDeviation = logReturns.length >= 20 ? sampleDeviation(logReturns.slice(split)) : null;
  let trend: VolatilityMetrics["trend"] = null;
  if (firstDeviation !== null && lastDeviation !== null) {
    trend = lastDeviation > firstDeviation * 1.05 ? "up" : lastDeviation < firstDeviation * 0.95 ? "down" : "stable";
  }
  const last = points.at(-1);
  const lastDay = last ? new Date(last.timestamp).toISOString().slice(0, 10) : null;
  const lastDayValues = points.filter((point) => new Date(point.timestamp).toISOString().slice(0, 10) === lastDay).map((point) => point.value);
  const latestCandle = historySource === "daily" ? daily.findLast((point) => point.time === last?.time) : undefined;
  const high = latestCandle?.high, low = latestCandle?.low;
  const candleRange = typeof high === "number" && typeof low === "number" && Number.isFinite(high) && Number.isFinite(low) && high >= low && low > 0 ? (high / low - 1) * 100 : null;
  const lastObservedDayRangePct = candleRange ?? observedRange(lastDayValues);
  const intervalLabel = interval === "daily" ? "일 관측 (252일 연율)" : interval === "intraday" ? `${Number(middle?.toFixed(2))}분 관측` : interval === "irregular" ? "불규칙 관측 간격" : "관측 부족";
  return {
    observations: points.length, returns: logReturns.length, interval, intervalLabel,
    intervalMinutes: interval === "intraday" ? middle : null,
    standardDeviationPct: deviation === null ? null : deviation * 100,
    annualizedVolatilityPct: deviation !== null && interval === "daily" ? deviation * Math.sqrt(252) * 100 : null,
    impliedVolatilityPct: null, rsi14: wilderRsi(values),
    lastObservedDayRangePct, observedRangePct: observedRange(values),
    trend, firstObserved: points[0]?.time || null, lastObserved: last?.time || null, values,
    historySource, rangeSource: candleRange !== null ? "daily-ohlc" : lastObservedDayRangePct !== null ? "observed-price" : "unavailable",
  };
}

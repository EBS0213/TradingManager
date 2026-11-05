import type { MarketItem } from "../types";
export type RmiRange = "1D" | "1W" | "1M" | "3M" | "YTD" | "1Y";
export function buildRmiSeries(security?: MarketItem, benchmark?: MarketItem, range: RmiRange = "1M") {
  const prices = (security?.history || []).filter((point) => Number.isFinite(point.value) && point.value > 0 && Number.isFinite(Date.parse(point.time))).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const comparison = (benchmark?.history || []).filter((point) => Number.isFinite(point.value) && point.value > 0 && Number.isFinite(Date.parse(point.time)));
  if (!prices.length || !comparison.length) return [];
  const latest = Date.parse(prices[prices.length - 1].time);
  const days = { "1D": 1, "1W": 7, "1M": 31, "3M": 93, "1Y": 366, YTD: 366 }[range];
  const cutoff = range === "YTD" ? Date.UTC(new Date(latest).getUTCFullYear(), 0, 1) : latest - days * 86400000;
  const intraday = new Set(prices.map((point) => point.time.slice(0, 10))).size < prices.length || new Set(comparison.map((point) => point.time.slice(0, 10))).size < comparison.length;
  const key = (time: string) => new Date(time).toISOString().slice(0, intraday ? 16 : 10);
  const benchmarkByTime = new Map(comparison.map((point) => [key(point.time), point.value]));
  const aligned = prices.filter((point) => Date.parse(point.time) >= cutoff && benchmarkByTime.has(key(point.time))).map((point) => ({ time: point.time, value: point.value, benchmark: benchmarkByTime.get(key(point.time))! }));
  if (!aligned.length) return [];
  const base = aligned[0];
  return aligned.map((point) => ({ ...point, label: intraday ? new Date(point.time).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }) : new Date(point.time).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }), rmi: (point.value / base.value) / (point.benchmark / base.benchmark) * 100 }));
}
export function correlation(points: ReturnType<typeof buildRmiSeries>): number | null {
  if (points.length < 3) return null;
  const pairs = points.slice(1).map((point, i) => [point.value / points[i].value - 1, point.benchmark / points[i].benchmark - 1]);
  const mx = pairs.reduce((sum, point) => sum + point[0], 0) / pairs.length;
  const my = pairs.reduce((sum, point) => sum + point[1], 0) / pairs.length;
  const numerator = pairs.reduce((sum, point) => sum + (point[0] - mx) * (point[1] - my), 0);
  const denominator = Math.sqrt(pairs.reduce((sum, point) => sum + (point[0] - mx) ** 2, 0) * pairs.reduce((sum, point) => sum + (point[1] - my) ** 2, 0));
  return denominator ? numerator / denominator : null;
}

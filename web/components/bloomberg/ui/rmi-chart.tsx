"use client";
import { useAtom } from "jotai";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { isDarkModeAtom, rmiTimeRangeAtom } from "../atoms";
import { bloombergColors } from "../lib/theme-config";
import { formatNumber } from "../lib/format";
import { buildRmiSeries, type RmiRange } from "../lib/rmi-series";
import type { MarketItem } from "../types";
export function RmiChart({ marketItem, benchmarkItem, height = 340 }: { marketItem: MarketItem; benchmarkItem?: MarketItem; width?: number; height?: number }) {
  const [isDarkMode] = useAtom(isDarkModeAtom);
  const [timeRange, setTimeRange] = useAtom(rmiTimeRangeAtom);
  const colors = isDarkMode ? bloombergColors.dark : bloombergColors.light;
  const data = buildRmiSeries(marketItem, benchmarkItem, timeRange);
  const last = data[data.length - 1];
  const color = last && last.rmi >= 100 ? colors.positive : colors.negative;
  return <section className="p-4 border" style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
    <div className="flex flex-wrap justify-between gap-2 mb-3"><div><h3 className="text-sm font-bold">{marketItem.id} Relative Market Index</h3><p className="text-xs text-gray-400">vs {benchmarkItem?.id || "벤치마크 선택"}</p></div>
      <div className="flex flex-wrap gap-1">{(["1D", "1W", "1M", "3M", "YTD", "1Y"] as RmiRange[]).map((range) => <button key={range} type="button" aria-pressed={timeRange === range} onClick={() => setTimeRange(range)} className="px-2 py-1 text-xs border" style={{ borderColor: colors.border, backgroundColor: timeRange === range ? colors.accent : "transparent", color: timeRange === range ? "#111" : colors.text }}>{range}</button>)}</div>
    </div>
    {data.length < 2 ? <p className="p-8 text-center text-xs text-gray-400">선택 구간에 두 종목의 공통 날짜 관측값이 2개 이상 필요합니다. 날짜가 없는 스파크라인으로 과거 수익률을 만들지 않습니다.</p> : <>
      <div className="text-sm mb-2" style={{ color }}>RMI {formatNumber(last.rmi)} · 기준 100 · {data.length}개 관측</div>
      <div className="w-full" style={{ height, minWidth: 0 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={colors.border} strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 10, fill: colors.textSecondary }} /><YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: colors.textSecondary }} />
        <Tooltip contentStyle={{ background: colors.surface, color: colors.text, borderColor: colors.border, fontSize: 12 }} formatter={(value: unknown) => [formatNumber(value), "RMI"]} />
        <Area type="linear" dataKey="rmi" stroke={color} fill={color} fillOpacity={0.12} isAnimationActive={false} />
      </AreaChart></ResponsiveContainer></div>
      <p className="text-xs text-gray-400 mt-2">실제 공통 날짜의 가격을 각 구간 시작점 100으로 정규화합니다.</p>
    </>}
  </section>;
}

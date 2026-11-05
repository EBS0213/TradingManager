"use client";

import type { MarketData, MarketItem } from "../types";
import { formatNumber, formatPercent } from "../lib/format";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowDown, ArrowLeft, ArrowUp, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { calculateVolatilityMetrics } from "../lib/volatility";
import { BloombergButton } from "../core/bloomberg-button";
import { bloombergColors } from "../lib/theme-config";
import { Sparkline } from "../ui/sparkline";

type MarketIndex = MarketItem & { region?: string };

interface VolatilityData {
  id: string;
  region: string;
  historicalVol: number;
  impliedVol?: number;
  volRatio: number;
  volTrend: "up" | "down" | "stable";
  dailyRange: number;
  weeklyRange: number;
  rsi?: number;
  sparkline: number[];
  value: number;
  change: number;
  pctChange: number;
}

interface VolatilityViewProps {
  isDarkMode: boolean;
  onBack: () => void;
  marketData: MarketData;
  onRefresh: () => void;
  isLoading: boolean;
}

function DemoVolatilityView({
  isDarkMode,
  onBack,
  marketData,
  onRefresh,
  isLoading,
}: VolatilityViewProps) {
  const [volatilityData, setVolatilityData] = useState<VolatilityData[]>([]);
  const [filterType, setFilterType] = useState<"all" | "high" | "low">("all");
  const [sortField, setSortField] = useState<"historicalVol" | "volRatio" | "dailyRange">(
    "historicalVol"
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [showRegions, setShowRegions] = useState<Record<string, boolean>>({
    americas: true,
    emea: true,
    asiaPacific: true,
  });

  const colors = isDarkMode ? bloombergColors.dark : bloombergColors.light;

  // Calculate volatility metrics from market data
  useEffect(() => {
    const calculateVolatilityData = () => {
      const result: VolatilityData[] = [];

      // Process Americas
      if (marketData.americas) {
        for (const index of marketData.americas) {
          // Generate realistic volatility metrics based on existing data
          const historicalVol = generateHistoricalVolatility(index);
          const impliedVol = historicalVol * (1 + (Math.random() * 0.4 - 0.2)); // IV is usually close to HV but can vary
          const volRatio = historicalVol / (10 + Math.random() * 5); // Compare to baseline volatility
          const volTrend = Math.random() > 0.5 ? "up" : Math.random() > 0.5 ? "down" : "stable";
          const dailyRange = Math.abs(index.pctChange) * (0.8 + Math.random() * 0.4); // Daily high-low range
          const weeklyRange = dailyRange * (2 + Math.random()); // Weekly range is larger than daily
          const rsi = 30 + Math.random() * 40; // RSI between 30 and 70 typically

          result.push({
            id: index.id,
            region: "Americas",
            historicalVol,
            impliedVol,
            volRatio,
            volTrend: volTrend as "up" | "down" | "stable",
            dailyRange,
            weeklyRange,
            rsi,
            sparkline: generateVolatilitySparkline(
              historicalVol,
              volTrend as "up" | "down" | "stable"
            ),
            value: index.value,
            change: index.change,
            pctChange: index.pctChange,
          });
        }
      }

      // Process EMEA
      if (marketData.emea) {
        for (const index of marketData.emea) {
          const historicalVol = generateHistoricalVolatility(index);
          const impliedVol = historicalVol * (1 + (Math.random() * 0.4 - 0.2));
          const volRatio = historicalVol / (10 + Math.random() * 5);
          const volTrend = Math.random() > 0.5 ? "up" : Math.random() > 0.5 ? "down" : "stable";
          const dailyRange = Math.abs(index.pctChange) * (0.8 + Math.random() * 0.4);
          const weeklyRange = dailyRange * (2 + Math.random());
          const rsi = 30 + Math.random() * 40;

          result.push({
            id: index.id,
            region: "EMEA",
            historicalVol,
            impliedVol,
            volRatio,
            volTrend: volTrend as "up" | "down" | "stable",
            dailyRange,
            weeklyRange,
            rsi,
            sparkline: generateVolatilitySparkline(
              historicalVol,
              volTrend as "up" | "down" | "stable"
            ),
            value: index.value,
            change: index.change,
            pctChange: index.pctChange,
          });
        }
      }

      // Process Asia/Pacific
      if (marketData.asiaPacific) {
        for (const index of marketData.asiaPacific) {
          const historicalVol = generateHistoricalVolatility(index);
          const impliedVol = historicalVol * (1 + (Math.random() * 0.4 - 0.2));
          const volRatio = historicalVol / (10 + Math.random() * 5);
          const volTrend = Math.random() > 0.5 ? "up" : Math.random() > 0.5 ? "down" : "stable";
          const dailyRange = Math.abs(index.pctChange) * (0.8 + Math.random() * 0.4);
          const weeklyRange = dailyRange * (2 + Math.random());
          const rsi = 30 + Math.random() * 40;

          result.push({
            id: index.id,
            region: "Asia/Pacific",
            historicalVol,
            impliedVol,
            volRatio,
            volTrend: volTrend as "up" | "down" | "stable",
            dailyRange,
            weeklyRange,
            rsi,
            sparkline: generateVolatilitySparkline(
              historicalVol,
              volTrend as "up" | "down" | "stable"
            ),
            value: index.value,
            change: index.change,
            pctChange: index.pctChange,
          });
        }
      }

      return result;
    };

    const data = calculateVolatilityData();
    setVolatilityData(data);
  }, [marketData]);

  // Generate realistic historical volatility based on market data
  const generateHistoricalVolatility = (index: MarketIndex): number => {
    // Base volatility on absolute percentage change and add some randomness
    const baseVol = Math.abs(index.pctChange) * (1.5 + Math.random());

    // Add some market-specific adjustments
    let adjustedVol = baseVol;

    // Emerging markets tend to be more volatile
    if (
      index.id.includes("IBOVESPA") ||
      index.id.includes("HANG SENG") ||
      index.id.includes("CSI 300")
    ) {
      adjustedVol *= 1.3;
    }

    // Major indices tend to be less volatile
    if (
      index.id.includes("S&P 500") ||
      index.id.includes("DOW JONES") ||
      index.id.includes("FTSE 100")
    ) {
      adjustedVol *= 0.8;
    }

    // Ensure volatility is within realistic bounds (5% to 35%)
    return Math.max(5, Math.min(35, adjustedVol));
  };

  // Generate volatility sparkline data
  const generateVolatilitySparkline = (
    baseVol: number,
    trend: "up" | "down" | "stable"
  ): number[] => {
    const result = [];
    let currentVol = baseVol * 0.8; // Start a bit lower than current

    for (let i = 0; i < 10; i++) {
      // Add some randomness
      const noise = (Math.random() - 0.5) * 2;

      // Apply trend
      if (trend === "up") {
        currentVol += baseVol * 0.05 + noise;
      } else if (trend === "down") {
        currentVol -= baseVol * 0.05 - noise;
      } else {
        currentVol += noise;
      }

      // Keep within bounds
      currentVol = Math.max(baseVol * 0.5, Math.min(baseVol * 1.5, currentVol));

      result.push(currentVol);
    }

    // Normalize to 0-1 range for sparkline
    const min = Math.min(...result);
    const max = Math.max(...result);
    const range = max - min || 1;

    return result.map((val) => (val - min) / range);
  };

  // Filter and sort volatility data
  const getFilteredAndSortedData = () => {
    return volatilityData
      .filter((item) => {
        // Filter by region
        if (!showRegions[item.region === "Asia/Pacific" ? "asiaPacific" : item.region.toLowerCase()]) {
          return false;
        }

        // Filter by volatility level
        if (filterType === "high" && item.historicalVol < 15) {
          return false;
        }
        if (filterType === "low" && item.historicalVol >= 15) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Sort by selected field
        const aValue = a[sortField];
        const bValue = b[sortField];

        if (sortOrder === "asc") {
          return aValue - bValue;
        }
        return bValue - aValue;
      });
  };

  const handleFilterChange = (type: "all" | "high" | "low") => {
    setFilterType(type);
  };

  const handleSortFieldChange = (field: "historicalVol" | "volRatio" | "dailyRange") => {
    if (sortField === field) {
      // Toggle sort order if clicking the same field
      setSortOrder(sortOrder === "desc" ? "asc" : "desc");
    } else {
      // Set new field and default to descending
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const handleRegionToggle = (region: string) => {
    setShowRegions((prev) => ({
      ...prev,
      [region]: !prev[region],
    }));
  };

  // Get color class based on volatility level
  const getVolatilityColorClass = (vol: number) => {
    if (vol >= 25) return `text-[var(--terminal-negative)] font-bold`;
    if (vol >= 15) return `text-[var(--terminal-negative)]`;
    if (vol >= 10) return `text-[var(--terminal-accent)]`;
    return `text-[var(--terminal-positive)]`;
  };

  // Get background class based on volatility level
  const getVolatilityBgClass = (vol: number) => {
    if (vol >= 25) return "bg-red-900/20";
    if (vol >= 15) return "bg-red-900/10";
    if (vol >= 10) return "bg-amber-900/10";
    return "bg-green-900/10";
  };

  // Get trend icon
  const getTrendIcon = (trend: "up" | "down" | "stable") => {
    if (trend === "up") return <TrendingUp className={`h-3 w-3 text-[var(--terminal-negative)]`} />;
    if (trend === "down") return <TrendingDown className={`h-3 w-3 text-[var(--terminal-positive)]`} />;
    return <span className="text-gray-500">—</span>;
  };

  const filteredData = getFilteredAndSortedData();

  return (
    <div className={`font-mono bg-[var(--terminal-background)] text-[var(--terminal-text)]`}>
      {/* Header */}
      <div className={`flex items-center gap-2 bg-[var(--terminal-surface)] px-2 py-1`}>
        <BloombergButton color="default" onClick={onBack}>
          <ArrowLeft className="h-3 w-3 mr-1" />
          BACK
        </BloombergButton>
        <span className="text-sm font-bold">GLOBAL VOLATILITY</span>
        <div className="ml-auto flex items-center gap-2">
          <BloombergButton
            color={filterType === "all" ? "accent" : "default"}
            onClick={() => handleFilterChange("all")}
          >
            ALL
          </BloombergButton>
          <BloombergButton
            color={filterType === "high" ? "red" : "default"}
            onClick={() => handleFilterChange("high")}
          >
            HIGH VOL
          </BloombergButton>
          <BloombergButton
            color={filterType === "low" ? "green" : "default"}
            onClick={() => handleFilterChange("low")}
          >
            LOW VOL
          </BloombergButton>
          <BloombergButton color="accent" onClick={onRefresh} disabled={isLoading}>
            {isLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "REFR"}
          </BloombergButton>
        </div>
      </div>

      <p className="px-2 py-2 text-xs text-amber-400 border-b border-[var(--terminal-border)]">DEMO METRICS · 원본 프로그램의 변동성·IV·RSI 시뮬레이션입니다. 관측된 가격 변화에 예시 계산을 적용하며 실제 변동성 지표가 아닙니다.</p>
      {/* Filter Bar */}
      <div
        className={`flex flex-wrap items-center gap-2 bg-[var(--terminal-surface)] px-2 py-1 text-[var(--terminal-accent)] text-xs sm:text-sm`}
      >
        <span>Regions:</span>
        <div className="flex items-center gap-1">
          <Checkbox
            id="americas-vol"
            checked={showRegions.americas}
            onCheckedChange={() => handleRegionToggle("americas")}
            className="h-3 w-3 rounded-none border-gray-500 data-[state=checked]:bg-gray-500"
          />
          <label htmlFor="americas-vol">Americas</label>
        </div>
        <div className="flex items-center gap-1">
          <Checkbox
            id="emea-vol"
            checked={showRegions.emea}
            onCheckedChange={() => handleRegionToggle("emea")}
            className="h-3 w-3 rounded-none border-gray-500 data-[state=checked]:bg-gray-500"
          />
          <label htmlFor="emea-vol">EMEA</label>
        </div>
        <div className="flex items-center gap-1">
          <Checkbox
            id="asiaPacific-vol"
            checked={showRegions.asiaPacific}
            onCheckedChange={() => handleRegionToggle("asiaPacific")}
            className="h-3 w-3 rounded-none border-gray-500 data-[state=checked]:bg-gray-500"
          />
          <label htmlFor="asiaPacific-vol">Asia/Pacific</label>
        </div>

        <span className="ml-4">Sort By:</span>
        <BloombergButton
          color={sortField === "historicalVol" ? "accent" : "default"}
          onClick={() => handleSortFieldChange("historicalVol")}
          className="flex items-center gap-1"
        >
          HV
          {sortField === "historicalVol" &&
            (sortOrder === "desc" ? (
              <ArrowDown className="h-3 w-3 ml-1" />
            ) : (
              <ArrowUp className="h-3 w-3 ml-1" />
            ))}
        </BloombergButton>
        <BloombergButton
          color={sortField === "volRatio" ? "accent" : "default"}
          onClick={() => handleSortFieldChange("volRatio")}
          className="flex items-center gap-1"
        >
          RATIO
          {sortField === "volRatio" &&
            (sortOrder === "desc" ? (
              <ArrowDown className="h-3 w-3 ml-1" />
            ) : (
              <ArrowUp className="h-3 w-3 ml-1" />
            ))}
        </BloombergButton>
        <BloombergButton
          color={sortField === "dailyRange" ? "accent" : "default"}
          onClick={() => handleSortFieldChange("dailyRange")}
          className="flex items-center gap-1"
        >
          RANGE
          {sortField === "dailyRange" &&
            (sortOrder === "desc" ? (
              <ArrowDown className="h-3 w-3 ml-1" />
            ) : (
              <ArrowUp className="h-3 w-3 ml-1" />
            ))}
        </BloombergButton>
      </div>

      {/* Main Content */}
      <div className="overflow-x-auto">
        <Table className="w-full border-separate border-spacing-0">
          <TableHeader>
            <TableRow className={`bg-[var(--terminal-surface)]`}>
              <TableHead className="px-2 py-1 text-left font-bold">Market</TableHead>
              <TableHead className="px-2 py-1 text-center">Region</TableHead>
              <TableHead className="px-2 py-1 text-right">Hist Vol</TableHead>
              <TableHead className="px-2 py-1 text-right">Impl Vol</TableHead>
              <TableHead className="px-2 py-1 text-center">Trend</TableHead>
              <TableHead className="px-2 py-1 text-right">Vol Ratio</TableHead>
              <TableHead className="px-2 py-1 text-right">Daily Range</TableHead>
              <TableHead className="px-2 py-1 text-right hidden sm:table-cell">
                Weekly Range
              </TableHead>
              <TableHead className="px-2 py-1 text-center hidden md:table-cell">
                Vol Chart
              </TableHead>
              <TableHead className="px-2 py-1 text-right hidden md:table-cell">RSI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-4">
                  No indices match the current filter criteria
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((item, index) => (
                <TableRow
                  key={`${item.id}-${index}`}
                  className={`border-b border-[var(--terminal-border)] ${getVolatilityBgClass(item.historicalVol)}`}
                >
                  <TableCell className="px-2 py-1">
                    <div className="flex flex-col">
                      <span className={`text-[var(--terminal-accent)] text-xs`}>{item.id}</span>
                      <span className={`text-[var(--terminal-textSecondary)] text-xs`}>
                        {formatNumber(item.value, 2)} ({item.pctChange > 0 ? "+" : ""}
                        {formatNumber(item.pctChange, 2)}%)
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-center text-xs">{item.region}</TableCell>
                  <TableCell
                    className={`px-2 py-1 text-right text-xs ${getVolatilityColorClass(item.historicalVol)}`}
                  >
                    {formatNumber(item.historicalVol, 2)}%
                  </TableCell>
                  <TableCell
                    className={`px-2 py-1 text-right text-xs ${getVolatilityColorClass(item.impliedVol || 0)}`}
                  >
                    {formatNumber(item.impliedVol, 2)}%
                  </TableCell>
                  <TableCell className="px-2 py-1 text-center">
                    {getTrendIcon(item.volTrend)}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-right text-xs">
                    {formatNumber(item.volRatio, 2)}x
                  </TableCell>
                  <TableCell className="px-2 py-1 text-right text-xs">
                    {formatNumber(item.dailyRange, 2)}%
                  </TableCell>
                  <TableCell className="px-2 py-1 text-right text-xs hidden sm:table-cell">
                    {formatNumber(item.weeklyRange, 2)}%
                  </TableCell>
                  <TableCell className="px-2 py-1 w-[100px] hidden md:table-cell">
                    <div className="flex justify-center">
                      <Sparkline
                        data1={[]}
                        data2={item.sparkline}
                        width={80}
                        height={20}
                        color1={colors.sparklineGray}
                        color2={item.historicalVol >= 15 ? colors.negative : colors.positive}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-right hidden md:table-cell">
                    <div className="w-16">
                      <Progress value={item.rsi} max={100} className="h-2" />
                      <div className="text-xs mt-1 text-right">{formatNumber(item.rsi, 1)}</div>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}


function ObservedVolatilityView({ isDarkMode, onBack, marketData, onRefresh, isLoading }: VolatilityViewProps) {
  const colors = isDarkMode ? bloombergColors.dark : bloombergColors.light;
  const [region, setRegion] = useState("all");
  const [supportedOnly, setSupportedOnly] = useState(false);
  const [sort, setSort] = useState<"name" | "samples" | "range">("samples");
  const dailyQuery = useQuery<MarketData>({ queryKey: ["terminal-market-data", "daily"],
    queryFn: async ({ signal }) => { const response = await fetch("/api/terminal/market-data?history=daily", { signal }); if (!response.ok) throw new Error("일봉 자료를 불러오지 못했습니다."); return response.json(); },
    staleTime: 15 * 60 * 1000, refetchOnWindowFocus: false, retry: 0 });
  const observedData = dailyQuery.data || marketData;
  const rows = useMemo(() => (["americas", "emea", "asiaPacific"] as const).flatMap((key) =>
    (observedData[key] || []).map((item) => ({ item, region: key, metrics: calculateVolatilityMetrics(item) }))), [observedData]);
  const refreshObserved = () => { onRefresh(); void dailyQuery.refetch(); };
  const supportedCount = rows.filter((row) => row.metrics.standardDeviationPct !== null).length;
  const visible = rows.filter((row) => (region === "all" || row.region === region) && (!supportedOnly || row.metrics.standardDeviationPct !== null)).sort((a, b) => sort === "name" ? a.item.id.localeCompare(b.item.id) : sort === "range" ? (b.metrics.observedRangePct ?? -1) - (a.metrics.observedRangePct ?? -1) : b.metrics.observations - a.metrics.observations);
  const regionNames: Record<string, string> = { americas: "Americas", emea: "EMEA", asiaPacific: "Asia/Pacific" };
  const percent = (value: number | null, digits = 2) => value === null ? "—" : `${formatNumber(value, digits)}%`;
  return <section style={{ color: colors.text, backgroundColor: colors.background }}>
    <div className="flex flex-wrap items-center gap-2 px-2 py-1" style={{ backgroundColor: colors.surface }}>
      <BloombergButton onClick={onBack}><ArrowLeft className="h-3 w-3 mr-1" />BACK</BloombergButton><h2 className="text-sm font-bold">GLOBAL VOLATILITY · OBSERVED</h2>
      <span className="text-xs text-amber-400">{supportedCount}/{rows.length} 지수 계산 가능</span>
      <BloombergButton className="ml-auto" color="accent" onClick={refreshObserved} disabled={isLoading || dailyQuery.isFetching}>{isLoading || dailyQuery.isFetching ? "WAIT" : "REFR"}</BloombergButton>
    </div>
    {dailyQuery.error ? <p role="status" className="text-amber-400">일봉 조회 실패</p> : null}
    <div className="flex flex-wrap items-center gap-2 p-2 border-b border-[var(--terminal-border)] text-xs">
      <label htmlFor="gvol-region">Region</label><select id="gvol-region" value={region} onChange={(event) => setRegion(event.target.value)} className="border px-2 py-1" style={{ backgroundColor: colors.surface, borderColor: colors.border }}><option value="all">ALL</option>{Object.entries(regionNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
      <label className="flex items-center gap-1"><input type="checkbox" checked={supportedOnly} onChange={(event) => setSupportedOnly(event.target.checked)} />계산 가능만</label>
      <label htmlFor="gvol-sort" className="sm:ml-auto">Sort</label><select id="gvol-sort" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="border px-2 py-1" style={{ backgroundColor: colors.surface, borderColor: colors.border }}><option value="samples">관측 개수</option><option value="name">지수 이름</option><option value="range">관측 범위</option></select>
    </div>
    <div className="overflow-x-auto"><Table className="w-full text-xs whitespace-nowrap"><TableHeader><TableRow>
      {["Market / Region", "가격 관측", "간격", "관측 σ", "연율 σ", "Implied Vol", "최근일 범위¹", "전체 관측 범위", "RSI14", "관측 가격"].map((label, index) => <TableHead key={label} className={index ? "text-right px-2 py-1" : "text-left px-2 py-1"}>{label}</TableHead>)}
    </TableRow></TableHeader><TableBody>
      {!visible.length && <TableRow><TableCell colSpan={10} className="py-6 text-center">이 조건에서 표시할 관측 데이터가 없습니다.</TableCell></TableRow>}
      {visible.map(({ item, region, metrics }) => <TableRow key={`${region}-${item.id}`}>
        <TableCell className="px-2 py-2"><span className="text-[var(--terminal-accent)]">{item.id}</span><small className="block text-[var(--terminal-textSecondary)]">{regionNames[region]}{item.dailyHistoryStatus === "stale" ? " · STALE" : ""}</small></TableCell>
        <TableCell className="text-right px-2 py-2" title={`${metrics.returns}개 수익률 표본 · 일봉 조회 ${item.dailyHistoryAsOf || "미제공"}`}>{metrics.observations || "—"}</TableCell>
        <TableCell className="text-right px-2 py-2">{metrics.intervalLabel}{metrics.lastObserved && <small className="block text-[var(--terminal-textSecondary)]">{metrics.firstObserved?.slice(0, 10)} ~ {metrics.lastObserved.slice(0, 10)}</small>}</TableCell>
        <TableCell className="text-right px-2 py-2">{percent(metrics.standardDeviationPct, 4)}</TableCell>
        <TableCell className="text-right px-2 py-2">{percent(metrics.annualizedVolatilityPct)}</TableCell>
        <TableCell className="text-right px-2 py-2 text-gray-500">—</TableCell>
        <TableCell className="text-right px-2 py-2" title={metrics.rangeSource === "daily-ohlc" ? "공개 일봉의 고가/저가 범위" : "관측가격의 최고/최저 범위"}>{percent(metrics.lastObservedDayRangePct)}<small className="block text-[var(--terminal-textSecondary)]">{metrics.rangeSource === "daily-ohlc" ? "OHLC" : metrics.rangeSource === "observed-price" ? "관측값" : ""}</small></TableCell>
        <TableCell className="text-right px-2 py-2">{percent(metrics.observedRangePct)}</TableCell>
        <TableCell className="text-right px-2 py-2">{metrics.rsi14 === null ? "—" : <span style={{ color: metrics.rsi14 >= 70 ? colors.negative : metrics.rsi14 <= 30 ? colors.positive : colors.text }}>{formatNumber(metrics.rsi14, 1)}</span>}</TableCell>
        <TableCell className="px-2 py-2" title={metrics.lastObserved ? `관측 시작 ${metrics.firstObserved} / 마지막 ${metrics.lastObserved}` : "과거 가격 미제공"}>{metrics.values.length > 1 ? <Sparkline data1={metrics.values} data2={[]} width={100} height={24} color1={colors.accent} /> : <span className="text-gray-500">—</span>}</TableCell>
      </TableRow>)}
    </TableBody></Table></div>
    
  </section>;
}

export default function VolatilityView(props: VolatilityViewProps) {
  const [mode, setMode] = useState<"observed" | "demo">("observed");
  return <div>
    <div className="flex flex-wrap gap-2 items-center p-2 border-b border-[var(--terminal-border)] text-xs">
      <span className="text-[var(--terminal-textSecondary)]">GVOL MODE</span>
      <BloombergButton color={mode === "observed" ? "accent" : "default"} aria-pressed={mode === "observed"} onClick={() => setMode("observed")}>실제 관측</BloombergButton>
      <BloombergButton color={mode === "demo" ? "accent" : "default"} aria-pressed={mode === "demo"} onClick={() => setMode("demo")}>원본 DEMO</BloombergButton>
      {mode === "demo" && <span className="text-amber-400">예시 시뮬레이션 · 실제 지표 아님</span>}
    </div>
    {mode === "observed" ? <ObservedVolatilityView {...props} /> : <DemoVolatilityView {...props} />}
  </div>;
}

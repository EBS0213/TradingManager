"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAtom } from "jotai";
import { useEffect } from "react";
import { currentViewAtom, isDarkModeAtom, rmiBenchmarkIndexAtom, rmiSelectedRegionAtom, rmiSelectedSecurityAtom, rmiTimeRangeAtom } from "../atoms";
import { BloombergButton } from "../core/bloomberg-button";
import { useMarketDataQuery } from "../hooks/useMarketDataQuery";
import { bloombergColors } from "../lib/theme-config";
import { formatNumber, formatPercent } from "../lib/format";
import { buildRmiSeries, correlation } from "../lib/rmi-series";
import { AiMarketAnalysis } from "../ui/ai-market-analysis";
import { RmiChart } from "../ui/rmi-chart";
export function RmiView() {
  const { marketData, isLoading, error, refreshData } = useMarketDataQuery();
  const [isDarkMode] = useAtom(isDarkModeAtom);
  const [, setCurrentView] = useAtom(currentViewAtom);
  const [region, setRegion] = useAtom(rmiSelectedRegionAtom);
  const [selected, setSelected] = useAtom(rmiSelectedSecurityAtom);
  const [benchmark, setBenchmark] = useAtom(rmiBenchmarkIndexAtom);
  const [range] = useAtom(rmiTimeRangeAtom);
  const colors = isDarkMode ? bloombergColors.dark : bloombergColors.light;
  const securities = marketData?.[region] || [];
  useEffect(() => {
    if (!securities.some((item) => item.id === selected)) setSelected(securities[0]?.id || "");
    const others = securities.filter((item) => item.id !== selected);
    if (!others.some((item) => item.id === benchmark)) setBenchmark(others[0]?.id);
  }, [securities, selected, benchmark, setSelected, setBenchmark]);
  const security = securities.find((item) => item.id === selected);
  const benchmarkSecurity = securities.find((item) => item.id === benchmark);
  const points = buildRmiSeries(security, benchmarkSecurity, range);
  const last = points[points.length - 1];
  const coefficient = correlation(points);
  const selectionStyle = { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border };
  if (isLoading) return <p className="p-4 text-xs">RMI 데이터 로딩 중…</p>;
  if (error || !marketData) return <div className="p-4 text-xs"><p>시장 데이터를 불러오지 못했습니다.</p><BloombergButton onClick={refreshData}>RETRY</BloombergButton></div>;
  return <div className="p-3" style={{ backgroundColor: colors.background, color: colors.text }}>
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div className="flex items-center gap-2"><BloombergButton onClick={() => setCurrentView("market")}>BACK</BloombergButton><h2 className="text-sm font-bold">Relative Market Index</h2></div>
      <div className="flex flex-wrap gap-2">
        <div><label htmlFor="rmi-region" className="block text-xs mb-1">Region</label><Select value={region} onValueChange={(value) => setRegion(value as typeof region)}><SelectTrigger id="rmi-region" className="w-40 h-8 text-xs rounded-none" style={selectionStyle}><SelectValue /></SelectTrigger><SelectContent style={selectionStyle}><SelectItem value="americas">AMERICAS</SelectItem><SelectItem value="emea">EMEA</SelectItem><SelectItem value="asiaPacific">ASIA PACIFIC</SelectItem></SelectContent></Select></div>
        <div><label htmlFor="rmi-security" className="block text-xs mb-1">Security</label><Select value={selected} onValueChange={setSelected}><SelectTrigger id="rmi-security" className="w-40 h-8 text-xs rounded-none" style={selectionStyle}><SelectValue placeholder="종목 선택" /></SelectTrigger><SelectContent style={selectionStyle}>{securities.map((item) => <SelectItem key={item.id} value={item.id}>{item.id}</SelectItem>)}</SelectContent></Select></div>
        <div><label htmlFor="rmi-benchmark" className="block text-xs mb-1">Benchmark</label><Select value={benchmark || ""} onValueChange={setBenchmark}><SelectTrigger id="rmi-benchmark" className="w-40 h-8 text-xs rounded-none" style={selectionStyle}><SelectValue placeholder="벤치마크 선택" /></SelectTrigger><SelectContent style={selectionStyle}>{securities.filter((item) => item.id !== selected).map((item) => <SelectItem key={item.id} value={item.id}>{item.id}</SelectItem>)}</SelectContent></Select></div>
      </div>
    </div>
    {!securities.length && <p className="p-4 text-xs">이 지역의 시장 데이터가 없습니다.</p>}
    <Tabs defaultValue="chart"><TabsList className="w-full flex rounded-none mb-3" style={selectionStyle}>{["chart", "table", "analysis"].map((tab) => <TabsTrigger key={tab} value={tab} className="flex-1 rounded-none data-[state=active]:text-amber-500">{tab.toUpperCase()}</TabsTrigger>)}</TabsList>
      <TabsContent value="chart">{security && <RmiChart marketItem={security} benchmarkItem={benchmarkSecurity} />}<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">{[security, benchmarkSecurity].map((item, index) => <section key={index} className="p-3 border" style={selectionStyle}><h3 className="text-sm font-bold mb-2">{index ? "Benchmark" : "Security"} Details</h3><dl className="text-xs grid grid-cols-2 gap-2"><dt>ID</dt><dd>{item?.id || "—"}</dd><dt>Value</dt><dd>{formatNumber(item?.value)}</dd><dt>Change</dt><dd>{formatPercent(item?.pctChange, true)}</dd><dt>YTD</dt><dd>{formatPercent(item?.ytd)}</dd></dl></section>)}</div></TabsContent>
      <TabsContent value="table"><section className="p-3 border overflow-x-auto" style={selectionStyle}><h3 className="text-sm font-bold mb-3">RMI Historical Data · {range}</h3>{!points.length ? <p className="text-xs">공통 날짜의 과거 관측값이 없습니다.</p> : <table className="w-full text-xs"><thead><tr><th className="text-left py-2">Date</th><th className="text-right">{selected}</th><th className="text-right">{benchmark}</th><th className="text-right">RMI</th><th className="text-right">Change</th></tr></thead><tbody>{points.map((point, index) => <tr key={`${point.time}-${index}`} className="border-t" style={{ borderColor: colors.border }}><td className="py-2">{new Date(point.time).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</td><td className="text-right">{formatNumber(point.value)}</td><td className="text-right">{formatNumber(point.benchmark)}</td><td className="text-right">{formatNumber(point.rmi)}</td><td className="text-right">{formatNumber(index ? point.rmi - points[index - 1].rmi : 0)}</td></tr>)}</tbody></table>}</section></TabsContent>
      <TabsContent value="analysis"><section className="p-3 border text-xs" style={selectionStyle}><h3 className="text-sm font-bold mb-3">RMI Analysis</h3><p>{selected || "종목"} / {benchmark || "벤치마크"} · {range}</p><p className="mt-2">현재 RMI: {formatNumber(last?.rmi)}{last ? last.rmi >= 100 ? " · 기준 구간 대비 상대 강세" : " · 기준 구간 대비 상대 약세" : " · 관측 데이터 부족"}</p><h4 className="font-bold mt-3">Correlation Analysis</h4><p className="mt-2">공통 관측 수익률 상관계수: {formatNumber(coefficient)} · {points.length}개 관측</p></section><AiMarketAnalysis selectedSecurity={security} benchmarkSecurity={benchmarkSecurity} colors={colors} /></TabsContent>
    </Tabs>
  </div>;
}

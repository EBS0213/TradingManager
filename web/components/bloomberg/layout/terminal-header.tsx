"use client";

import {
  Activity,
  AlertTriangle,
  BarChart2,
  Database,
  HelpCircle,
  Moon,
  Newspaper,
  RefreshCw,
  Sun,
  TrendingUp,
  Wifi,
} from "lucide-react";
import { BloombergButton } from "../core/bloomberg-button";
import { useMarketDataQuery } from "../hooks";

type TerminalHeaderProps = {
  isDarkMode: boolean;
  currentView: string;
  onMarketClick: () => void;
  onCancelClick: () => void;
  onNewClick: () => void;
  onBlancClick: () => void;
  onNewsClick: () => void;
  onMoversClick: () => void;
  onVolatilityClick: () => void;
  onRmiClick: () => void;
  onHelpClick: () => void;
  onThemeToggle: () => void;
};

export function TerminalHeader({
  isDarkMode,
  currentView,
  onMarketClick,
  onCancelClick,
  onNewClick,
  onBlancClick,
  onNewsClick,
  onMoversClick,
  onVolatilityClick,
  onRmiClick,
  onHelpClick,
  onThemeToggle,
}: TerminalHeaderProps) {
  const {
    isLoading,
    marketData,
    isRealTimeEnabled,
    isFromRedis,
    dataSource,
    lastUpdated,
    refreshData,
    toggleRealTimeUpdates,
  } = useMarketDataQuery();

  const dataStatus = typeof marketData?.status === "string" ? marketData.status : "unavailable";
  const statusColor = dataStatus === "unavailable" ? "text-red-500" : "text-amber-500";
  // Snapshot retrieval time is not the exchange observation time.
  const queryAgeSeconds = lastUpdated ? Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000)) : null;

  return (
    <div className={`flex flex-wrap gap-1 bg-[var(--terminal-surface)] px-2 py-1`}>
      <BloombergButton color={currentView === "market" ? "accent" : "green"} onClick={onMarketClick}>MKT</BloombergButton>
      <BloombergButton color="red" onClick={onCancelClick}>
        CANCL
      </BloombergButton>
      <BloombergButton color="green" onClick={onNewClick}>
        NEW
      </BloombergButton>
      <BloombergButton color="green" onClick={onBlancClick}>
        BLANC
      </BloombergButton>
      <BloombergButton color={currentView === "news" ? "accent" : "green"} onClick={onNewsClick}>
        <Newspaper className="h-3 w-3 mr-1" />
        NEWS
      </BloombergButton>
      <BloombergButton color={currentView === "movers" ? "accent" : "green"} onClick={onMoversClick}>
        <TrendingUp className="h-3 w-3 mr-1" />
        GMOV
      </BloombergButton>
      <BloombergButton color={currentView === "volatility" ? "accent" : "green"} onClick={onVolatilityClick}>
        <BarChart2 className="h-3 w-3 mr-1" />
        GVOL
      </BloombergButton>
      <BloombergButton color={currentView === "rmi" ? "accent" : "green"} onClick={onRmiClick}>
        <Activity className="h-3 w-3 mr-1" />
        RMI
      </BloombergButton>

      <BloombergButton color="accent" onClick={onHelpClick}>
        <HelpCircle className="h-3 w-3 mr-1" />
        HELP
      </BloombergButton>

      <BloombergButton color="accent" onClick={onThemeToggle}>
        {isDarkMode ? <Sun className="h-3 w-3 mr-1" /> : <Moon className="h-3 w-3 mr-1" />}
        {isDarkMode ? "LIGHT" : "DARK"}
      </BloombergButton>

      {/* Redis Control Buttons */}
      <div className="ml-auto flex items-center gap-2">
        <BloombergButton color="accent" onClick={refreshData} disabled={isLoading}>
          REFR
        </BloombergButton>
        <BloombergButton
          color={isRealTimeEnabled ? "red" : "green"}
          onClick={toggleRealTimeUpdates}
          disabled={isLoading}
        >
          {isRealTimeEnabled ? "STOP" : "POLL"}
        </BloombergButton>

        {/* Data Status */}
        <div className="flex items-center gap-2 text-xs">
          {isLoading ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : isRealTimeEnabled ? (
            <Wifi className={`h-3 w-3 ${statusColor}`} />
          ) : isFromRedis ? (
            <Database className={`h-3 w-3 ${statusColor}`} />
          ) : (
            <AlertTriangle className="h-3 w-3 text-yellow-500" />
          )}

          <span className={statusColor} title="시세 상태 · 각 종목의 관측 시각은 표에서 확인">시세 {dataStatus.toUpperCase()}</span>
          <span className="text-[var(--terminal-textSecondary)]" title={lastUpdated ? `서버 조회 시각: ${lastUpdated.toISOString()} · 시세 관측 시각과 다를 수 있습니다` : "서버 조회 시각 없음"}>
            조회 {queryAgeSeconds === null ? "—" : `${queryAgeSeconds}s 전`}
          </span>
        </div>
      </div>
    </div>
  );
}

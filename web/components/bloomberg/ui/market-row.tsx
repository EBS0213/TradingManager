"use client";

import { TableCell, TableRow } from "@/components/ui/table";
import { useAtom } from "jotai";
import { SparklineCell } from ".";
import {
  currentViewAtom,
  filtersAtom,
  rmiBenchmarkIndexAtom,
  rmiSelectedRegionAtom,
  rmiSelectedSecurityAtom,
  show10DAtom,
  showAvatAtom,
  showCADAtom,
  showFuturesAtom,
  showMoversAtom,
  showRatiosAtom,
  showVolatilityAtom,
  showYTDAtom,
} from "../atoms";
import { formatNumber, formatPercent, formatMarketTime } from "../lib/format";
import { convertToCAD, formatCurrency } from "../lib/currency-utils";
import { bloombergColors, cn } from "../lib/theme-config";
import type { MarketItem } from "../types";

type MarketRowProps = {
  item: MarketItem;
  region: string;
  isDarkMode: boolean;
  updatedCells: Record<string, boolean>;
  updatedSparklines: Record<string, boolean>;
};

export function MarketRow({
  item,
  region,
  isDarkMode,
  updatedCells,
  updatedSparklines,
}: MarketRowProps) {
  // Jotai atoms for filter state
  const [filters] = useAtom(filtersAtom);
  const [showCAD] = useAtom(showCADAtom);
  const [showYTD] = useAtom(showYTDAtom);
  const [showAvat] = useAtom(showAvatAtom);
  const [show10D] = useAtom(show10DAtom);
  const [showMovers] = useAtom(showMoversAtom);
  const [showVolatility] = useAtom(showVolatilityAtom);
  const [showRatios] = useAtom(showRatiosAtom);
  const [showFutures] = useAtom(showFuturesAtom);
  // Jotai atoms for navigation
  const [, setCurrentView] = useAtom(currentViewAtom);
  const [, setSelectedRegion] = useAtom(rmiSelectedRegionAtom);
  const [, setSelectedSecurity] = useAtom(rmiSelectedSecurityAtom);
  const [, setBenchmarkIndex] = useAtom(rmiBenchmarkIndexAtom);

  const colors = isDarkMode ? bloombergColors.dark : bloombergColors.light;
  const fixedColumnClass = "w-[120px] sm:w-[140px] whitespace-nowrap overflow-hidden text-ellipsis";

  // Handle RMI cell click to navigate to RMI view
  const handleRmiClick = () => {
    // Set the region based on the current row's region
    if (region === "americas") {
      setSelectedRegion("americas");
    } else if (region === "emea") {
      setSelectedRegion("emea");
    } else if (region === "asiaPacific") {
      setSelectedRegion("asiaPacific");
    }
    // Set the selected security and default benchmark
    setSelectedSecurity(item.id);
    setBenchmarkIndex("SPX:IND"); // Default benchmark
    // Navigate to RMI view
    setCurrentView("rmi");
  };

  return (
    <TableRow className={`border-b border-[var(--terminal-border)]`}>
      <TableCell
        className={cn(`sticky left-0 bg-[var(--terminal-background)] px-2 py-1`, fixedColumnClass)}
      >
        <div className="flex items-center gap-2">
          <span className={`text-[var(--terminal-textSecondary)] text-xs`}>{item.num}</span>
          <span className={`text-[var(--terminal-accent)] text-xs`} >{item.id}</span>
          {item.dataStatus === "unavailable" && <span className="text-[9px] text-gray-500" title="시세 미제공">—</span>}
          {item.dataStatus === "stale" && <span className="text-[9px] text-amber-400" title="이전 수집 시세">STALE</span>}
        </div>
      </TableCell>
      <TableCell
        className="px-2 py-1 text-center text-xs cursor-pointer hover:underline"
        style={{ color: colors.accent }}
        onClick={handleRmiClick}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleRmiClick(); } }}
        tabIndex={0}
        role="button"
        aria-label={`${item.id} RMI 분석`}
        title="Click to view RMI analysis"
      >
        {item.rmi || "RMI"}
      </TableCell>

      <SparklineCell
        item={item}
        region={region}
        isDarkMode={isDarkMode}
        isHighlighted={updatedSparklines[`${region}-${item.id}-sparkline`]}
      />

      <TableCell
        className={cn(
          `px-2 py-1 text-right text-[var(--terminal-value)] text-xs`,
          updatedCells[`${region}-${item.id}-value`] &&
            "bg-yellow-300 dark:bg-yellow-900 transition-colors duration-500"
        )}
      >
        {typeof item.value === "number" ? (
          showCAD && item.currency === "USD" ? (
            <span title={`예시 환율 1 USD = 1.36 CAD · USD: ${formatNumber(item.value)}`}>
              {formatCurrency(convertToCAD(item.value), "CAD")}
            </span>
          ) : (
            item.currency ? formatCurrency(item.value, item.currency) : formatNumber(item.value)
          )
        ) : (
          "N/A"
        )}
      </TableCell>
      <TableCell
        className={cn(
          "px-2 py-1 text-right text-xs",
          showYTD
            ? item.ytd > 0
              ? `text-[var(--terminal-positive)]`
              : `text-[var(--terminal-negative)]`
            : item.change > 0
              ? `text-[var(--terminal-positive)]`
              : `text-[var(--terminal-negative)]`,
          updatedCells[`${region}-${item.id}-change`] &&
            "bg-yellow-300 dark:bg-yellow-900 transition-colors duration-500"
        )}
      >
        {showYTD ? (
          <span title={`Daily change: ${item.change > 0 ? "+" : ""}${formatNumber(item.change)}`}>
            {item.ytd > 0 ? "+" : ""}
            {formatPercent(item.ytd)}
          </span>
        ) : typeof item.change === "number" ? (
          (item.change > 0 ? "+" : "") + formatNumber(item.change)
        ) : (
          "N/A"
        )}
      </TableCell>
      <TableCell
        className={cn(
          `px-2 py-1 text-right text-xs ${item.pctChange > 0 ? `text-[var(--terminal-positive)]` : `text-[var(--terminal-negative)]`}`,
          updatedCells[`${region}-${item.id}-pctChange`] &&
            "bg-yellow-300 dark:bg-yellow-900 transition-colors duration-500"
        )}
      >
        {typeof item.pctChange === "number"
          ? formatPercent(item.pctChange, true)
          : "N/A"}
      </TableCell>
      <TableCell
        className={cn(
          `px-2 py-1 text-right text-xs ${item.avat > 0 ? `text-[var(--terminal-positive)]` : `text-[var(--terminal-negative)]`} ${showAvat ? "sm:table-cell" : "hidden"}`,
          updatedCells[`${region}-${item.id}-avat`] &&
            "bg-yellow-300 dark:bg-yellow-900 transition-colors duration-500"
        )}
      >
        {typeof item.avat === "number" ? formatPercent(item.avat) : "N/A"}
      </TableCell>
      <TableCell
        className={cn(
          `px-2 py-1 text-right text-[var(--terminal-value)] text-xs hidden sm:table-cell`,
          updatedCells[`${region}-${item.id}-time`] &&
            "bg-yellow-300 dark:bg-yellow-900 transition-colors duration-500"
        )}
      >
        <span title={`${item.time || "자료 없음"} · 표시는 한국시간(KST)`}>{formatMarketTime(item.time)}</span>
      </TableCell>
      <TableCell
        className={cn(
          `px-2 py-1 text-right text-xs ${item.ytd > 0 ? `text-[var(--terminal-positive)]` : `text-[var(--terminal-negative)]`} hidden md:table-cell`,
          updatedCells[`${region}-${item.id}-ytd`] &&
            "bg-yellow-300 dark:bg-yellow-900 transition-colors duration-500"
        )}
      >
        {typeof item.ytd === "number" ? `${formatPercent(item.ytd)}` : "N/A"}
      </TableCell>
      <TableCell
        className={cn(
          `px-2 py-1 text-right text-xs ${item.ytdCur > 0 ? `text-[var(--terminal-positive)]` : `text-[var(--terminal-negative)]`} hidden md:table-cell`,
          updatedCells[`${region}-${item.id}-ytdCur`] &&
            "bg-yellow-300 dark:bg-yellow-900 transition-colors duration-500"
        )}
      >
        {typeof item.ytdCur === "number" ? formatPercent(item.ytdCur) : "N/A"}
      </TableCell>
    </TableRow>
  );
}

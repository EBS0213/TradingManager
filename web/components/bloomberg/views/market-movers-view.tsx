"use client";

import type { MarketData, MarketItem } from "../types";
import { formatMarketTime, formatNumber, formatPercent } from "../lib/format";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowDown, ArrowLeft, ArrowUp, Filter, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { BloombergButton } from "../core/bloomberg-button";
import { bloombergColors } from "../lib/theme-config";
import { Sparkline } from "../ui/sparkline";

type MarketIndex = MarketItem & { region?: string };

interface MarketMoversViewProps {
  isDarkMode: boolean;
  onBack: () => void;
  marketData: MarketData;
  onRefresh: () => void;
  isLoading: boolean;
}

export default function MarketMoversView({
  isDarkMode,
  onBack,
  marketData,
  onRefresh,
  isLoading,
}: MarketMoversViewProps) {
  const [sortedIndices, setSortedIndices] = useState<MarketIndex[]>([]);
  const [filterType, setFilterType] = useState<"all" | "gainers" | "losers">("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [minMove, setMinMove] = useState<number>(0);
  const [showRegions, setShowRegions] = useState<Record<string, boolean>>({
    americas: true,
    emea: true,
    asiaPacific: true,
  });

  const colors = isDarkMode ? bloombergColors.dark : bloombergColors.light;

  // Process and sort market data
  useEffect(() => {
    // Combine all regions into a single array
    const allIndices: MarketIndex[] = [];

    if (marketData.americas) {
      for (const index of marketData.americas) {
        allIndices.push({ ...index, region: "Americas" });
      }
    }

    if (marketData.emea) {
      for (const index of marketData.emea) {
        allIndices.push({ ...index, region: "EMEA" });
      }
    }

    if (marketData.asiaPacific) {
      for (const index of marketData.asiaPacific) {
        allIndices.push({ ...index, region: "Asia/Pacific" });
      }
    }

    // Filter based on selected criteria
    const filtered = allIndices.filter((index) => {
      // Filter by region
      if (!showRegions[index.region === "Asia/Pacific" ? "asiaPacific" : index.region?.toLowerCase() || ""]) {
        return false;
      }

      // Filter by movement type
      if (filterType === "gainers" && index.pctChange <= 0) {
        return false;
      }
      if (filterType === "losers" && index.pctChange >= 0) {
        return false;
      }

      // Filter by minimum movement
      return Math.abs(index.pctChange) >= minMove;
    });

    // Sort by percentage change
    filtered.sort((a, b) => {
      if (sortOrder === "desc") {
        return Math.abs(b.pctChange) - Math.abs(a.pctChange);
      }
      return Math.abs(a.pctChange) - Math.abs(b.pctChange);
    });

    setSortedIndices(filtered);
  }, [marketData, filterType, sortOrder, minMove, showRegions]);

  const handleFilterChange = (type: "all" | "gainers" | "losers") => {
    setFilterType(type);
  };

  const handleSortOrderChange = () => {
    setSortOrder(sortOrder === "desc" ? "asc" : "desc");
  };

  const handleMinMoveChange = (value: number) => {
    setMinMove(value);
  };

  const handleRegionToggle = (region: string) => {
    setShowRegions((prev) => ({
      ...prev,
      [region]: !prev[region],
    }));
  };

  // Get movement class based on percentage change
  const getMovementClass = (pctChange: number) => {
    const absChange = Math.abs(pctChange);
    if (absChange >= 3) return "font-bold text-lg";
    if (absChange >= 2) return "font-bold";
    if (absChange >= 1) return "font-semibold";
    return "";
  };

  return (
    <div className={`font-mono bg-[var(--terminal-background)] text-[var(--terminal-text)]`}>
      {/* Header */}
      <div className={`flex items-center gap-2 bg-[var(--terminal-surface)] px-2 py-1`}>
        <BloombergButton color="default" onClick={onBack}>
          <ArrowLeft className="h-3 w-3 mr-1" />
          BACK
        </BloombergButton>
        <span className="text-sm font-bold">GLOBAL MARKET MOVERS</span>
        <div className="ml-auto flex items-center gap-2">
          <BloombergButton
            color={filterType === "all" ? "accent" : "default"}
            onClick={() => handleFilterChange("all")}
          >
            ALL
          </BloombergButton>
          <BloombergButton
            color={filterType === "gainers" ? "green" : "default"}
            onClick={() => handleFilterChange("gainers")}
          >
            GAINERS
          </BloombergButton>
          <BloombergButton
            color={filterType === "losers" ? "red" : "default"}
            onClick={() => handleFilterChange("losers")}
          >
            LOSERS
          </BloombergButton>
          <BloombergButton color="default" onClick={handleSortOrderChange}>
            {sortOrder === "desc" ? (
              <ArrowDown className="h-3 w-3 mr-1" />
            ) : (
              <ArrowUp className="h-3 w-3 mr-1" />
            )}
            SORT
          </BloombergButton>
          <BloombergButton color="accent" onClick={onRefresh} disabled={isLoading}>
            {isLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "REFR"}
          </BloombergButton>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        className={`flex flex-wrap items-center gap-2 bg-[var(--terminal-surface)] px-2 py-1 text-[var(--terminal-accent)] text-xs sm:text-sm`}
      >
        <span>Regions:</span>
        <div className="flex items-center gap-1">
          <Checkbox
            id="americas"
            checked={showRegions.americas}
            onCheckedChange={() => handleRegionToggle("americas")}
            className="h-3 w-3 rounded-none border-gray-500 data-[state=checked]:bg-gray-500"
          />
          <label htmlFor="americas">Americas</label>
        </div>
        <div className="flex items-center gap-1">
          <Checkbox
            id="emea"
            checked={showRegions.emea}
            onCheckedChange={() => handleRegionToggle("emea")}
            className="h-3 w-3 rounded-none border-gray-500 data-[state=checked]:bg-gray-500"
          />
          <label htmlFor="emea">EMEA</label>
        </div>
        <div className="flex items-center gap-1">
          <Checkbox
            id="asiaPacific"
            checked={showRegions.asiaPacific}
            onCheckedChange={() => handleRegionToggle("asiaPacific")}
            className="h-3 w-3 rounded-none border-gray-500 data-[state=checked]:bg-gray-500"
          />
          <label htmlFor="asiaPacific">Asia/Pacific</label>
        </div>

        <span className="ml-4">Min % Move:</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <BloombergButton color="accent" className="flex items-center gap-1">
              <Filter className="h-3 w-3 mr-1" />
              {minMove}%
            </BloombergButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent style={{ backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }} className="font-mono text-xs">
            <DropdownMenuItem onClick={() => handleMinMoveChange(0)}>0%</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleMinMoveChange(0.5)}>0.5%</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleMinMoveChange(1)}>1%</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleMinMoveChange(2)}>2%</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleMinMoveChange(3)}>3%</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main Content */}
      <div className="overflow-x-auto">
        <Table className="w-full border-separate border-spacing-0">
          <TableHeader>
            <TableRow className={`bg-[var(--terminal-surface)]`}>
              <TableHead className="px-2 py-1 text-left font-bold">Market</TableHead>
              <TableHead className="px-2 py-1 text-center">Region</TableHead>
              <TableHead className={`px-2 py-1 text-center bg-[var(--terminal-surface)]`}>2Day</TableHead>
              <TableHead className="px-2 py-1 text-right">Value</TableHead>
              <TableHead className="px-2 py-1 text-right">Net Chg</TableHead>
              <TableHead className="px-2 py-1 text-right">%Chg</TableHead>
              <TableHead className="px-2 py-1 text-right hidden sm:table-cell">관측 (KST)</TableHead>
              <TableHead className="px-2 py-1 text-right hidden md:table-cell">%Ytd</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedIndices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-4">
                  No indices match the current filter criteria
                </TableCell>
              </TableRow>
            ) : (
              sortedIndices.map((item, index) => (
                <TableRow
                  key={`${item.id}-${index}`}
                  className={`border-b border-[var(--terminal-border)] ${
                    item.pctChange > 0
                      ? "bg-green-900/10"
                      : item.pctChange < 0
                        ? "bg-red-900/10"
                        : ""
                  }`}
                >
                  <TableCell className="px-2 py-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[var(--terminal-textSecondary)] text-xs`}>{item.num}</span>
                      <span className={`text-[var(--terminal-accent)] text-xs`}>{item.id}</span>
                    </div>
                    <div className="text-[10px]" >
                      <span className={item.dataStatus === "unavailable" ? "text-red-500" : item.dataStatus === "stale" ? "text-amber-500" : "text-[var(--terminal-textSecondary)]"}>
                        {(item.dataStatus || "unavailable").toUpperCase()}
                      </span>
                      <span className="text-[var(--terminal-textSecondary)] sm:hidden"> · 관측 {formatMarketTime(item.asOf || item.time)} KST</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-center text-xs">{item.region}</TableCell>
                  <TableCell className={`px-2 py-1 w-[100px] bg-[var(--terminal-surface)]`}>
                    <div className="flex justify-center">
                      <Sparkline
                        data1={item.sparkline1 || [0.5, 0.6, 0.4, 0.7, 0.5, 0.8, 0.6, 0.7]}
                        data2={item.sparkline2 || [0.7, 0.5, 0.8, 0.6, 0.9, 0.7, 1.0, 0.8]}
                        width={80}
                        height={20}
                        color1={colors.sparklineGray}
                        color2={item.change > 0 ? colors.positive : colors.negative}
                        isRealData={!!item.history?.length}
                      />
                    </div>
                  </TableCell>
                  <TableCell
                    className={`px-2 py-1 text-right text-[var(--terminal-value)] text-xs`}
                  >
                    {typeof item.value === "number" ? formatNumber(item.value, 2) : "N/A"}
                  </TableCell>
                  <TableCell
                    className={`px-2 py-1 text-right text-xs ${
                      item.change > 0 ? `text-[var(--terminal-positive)]` : `text-[var(--terminal-negative)]`
                    }`}
                  >
                    {typeof item.change === "number"
                      ? (item.change > 0 ? "+" : "") + formatNumber(item.change, 2)
                      : "N/A"}
                  </TableCell>
                  <TableCell
                    className={`px-2 py-1 text-right text-xs ${
                      item.pctChange > 0 ? `text-[var(--terminal-positive)]` : `text-[var(--terminal-negative)]`
                    } ${getMovementClass(item.pctChange)}`}
                  >
                    {typeof item.pctChange === "number"
                      ? formatPercent(item.pctChange, true)
                      : "N/A"}
                  </TableCell>
                  <TableCell
                    className={`px-2 py-1 text-right text-[var(--terminal-value)] text-xs hidden sm:table-cell`}
                    title={item.asOf || item.time || "관측 시각 없음"}
                  >
                    {formatMarketTime(item.asOf || item.time)}
                  </TableCell>
                  <TableCell
                    className={`px-2 py-1 text-right text-xs ${
                      item.ytd > 0 ? `text-[var(--terminal-positive)]` : `text-[var(--terminal-negative)]`
                    } hidden md:table-cell`}
                  >
                    {typeof item.ytd === "number" ? formatPercent(item.ytd) : "N/A"}
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

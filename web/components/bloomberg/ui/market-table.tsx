"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAtom, useSetAtom } from "jotai";
import { activeWatchlistAtom, clearMarketSelectionAtom, watchlistsAtom } from "../atoms/terminal-ui";
import { MarketSection } from ".";
import { filtersAtom, showAvatAtom } from "../atoms";
import { useMarketDataQuery } from "../hooks";
import { cn } from "../lib/theme-config";
import { filterMarketItems, marketItems, supportedMarketFilters } from "../lib/market-filters";
import type { MarketData } from "../types";

const fixedColumnClass = "w-[120px] sm:w-[140px] whitespace-nowrap overflow-hidden text-ellipsis";

type MarketTableProps = {
  data: MarketData;
  isDarkMode: boolean;
};

export function MarketTable({ data, isDarkMode }: MarketTableProps) {
  const { updatedCells, updatedSparklines } = useMarketDataQuery();
  const [filters] = useAtom(filtersAtom);
  const [activeWatchlist] = useAtom(activeWatchlistAtom);
  const [watchlists] = useAtom(watchlistsAtom);
  const clearSelection = useSetAtom(clearMarketSelectionAtom);
  const selectedList = watchlists.find((list) => list.name === activeWatchlist);
  const effectiveFilters = supportedMarketFilters(filters, data);
  const allItems = marketItems(data);
  const watchlistItems = (items: MarketData["americas"]) => selectedList ? items.filter((item) => selectedList.indices.includes(item.id)) : items;
  const visibleItems = (items: MarketData["americas"]) => filterMarketItems(watchlistItems(items), effectiveFilters);
  const selectedCount = watchlistItems(allItems).length;
  const visibleCount = visibleItems(allItems).length;
  const hasSelection = !!activeWatchlist || filters.showMovers || filters.showVolatility || filters.showRatios || filters.showFutures;
  const emptyMessage = (items: MarketData["americas"]) => !items.length ? "이 지역에 수집된 지수 데이터가 없습니다."
    : selectedList && !watchlistItems(items).length ? "관심목록에 이 지역의 지수가 없습니다."
    : "선택한 필터 조건에 맞는 지수가 없습니다.";
  const [showAvat] = useAtom(showAvatAtom);

  // Safety check for data
  if (!data) {
    return (
      <div className="p-4 text-center">
        <p>Loading market data...</p>
      </div>
    );
  }

  return (
    <>
    <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 text-xs text-[var(--terminal-textSecondary)]" role="status" aria-label="지수 표시 상태">
      <span>전체 {allItems.length}개 중 {visibleCount}개 지수 표시{selectedList ? ` · 관심목록: ${selectedList.name}` : ""}
        {visibleCount === 0 && allItems.length > 0 && (selectedList && selectedCount === 0 ? " · 관심목록에 표시할 지수가 없습니다." : " · 선택한 필터 조건에 맞는 지수가 없습니다.")}
      </span>
      {hasSelection && <button type="button" className="border border-[var(--terminal-accent)] px-2 py-1 text-[var(--terminal-accent)]" onClick={clearSelection}>전체 지수 보기</button>}
    </div>
    <Table className="w-full border-separate border-spacing-0">
      <TableHeader>
        <TableRow className={`bg-[var(--terminal-surface)]`}>
          <TableHead
            className={cn(
              `sticky left-0 bg-[var(--terminal-surface)] px-2 py-1 text-left font-bold`,
              fixedColumnClass
            )}
          >
            Market
          </TableHead>
          <TableHead className="px-2 py-1 text-center">RMI</TableHead>
          <TableHead className={`px-2 py-1 text-center bg-[var(--terminal-surface)]`}>{filters.show10D ? "10D" : "History"}</TableHead>
          <TableHead className="px-2 py-1 text-right">Value</TableHead>
          <TableHead className="px-2 py-1 text-right">{filters.showYTD ? "%YTD" : "Net Chg"}</TableHead>
          <TableHead className="px-2 py-1 text-right">%Chg</TableHead>
          <TableHead className={`px-2 py-1 text-right ${showAvat ? "sm:table-cell" : "hidden"}`}>
            Δ AVAT
          </TableHead>
          <TableHead className="px-2 py-1 text-right hidden sm:table-cell">Time</TableHead>
          <TableHead className="px-2 py-1 text-right hidden md:table-cell">%Ytd</TableHead>
          <TableHead className="px-2 py-1 text-right hidden md:table-cell">%YtdCur</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <MarketSection
          title="Americas"
          items={visibleItems(data.americas || [])}
          emptyMessage={emptyMessage(data.americas || [])}
          sectionNum="1)"
          isDarkMode={isDarkMode}
          updatedCells={updatedCells}
          updatedSparklines={updatedSparklines}
        />
        <MarketSection
          title="EMEA"
          items={visibleItems(data.emea || [])}
          emptyMessage={emptyMessage(data.emea || [])}
          sectionNum="2)"
          isDarkMode={isDarkMode}
          updatedCells={updatedCells}
          updatedSparklines={updatedSparklines}
        />
        <MarketSection
          title="Asia/Pacific"
          items={visibleItems(data.asiaPacific || [])}
          emptyMessage={emptyMessage(data.asiaPacific || [])}
          sectionNum="3)"
          isDarkMode={isDarkMode}
          updatedCells={updatedCells}
          updatedSparklines={updatedSparklines}
        />
      </TableBody>
    </Table>
    </>
  );
}

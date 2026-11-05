"use client";

import { TableCell, TableRow } from "@/components/ui/table";
import { MarketRow } from ".";
import { cn } from "../lib/theme-config";
import type { MarketItem } from "../types";

type MarketSectionProps = {
  title: string;
  items: MarketItem[];
  emptyMessage: string;
  sectionNum: string;
  isDarkMode: boolean;
  updatedCells: Record<string, boolean>;
  updatedSparklines: Record<string, boolean>;
};

// The table applies supported filters consistently across regions and watchlists.
export function MarketSection({ title, items, emptyMessage, sectionNum, isDarkMode, updatedCells, updatedSparklines }: MarketSectionProps) {
  const region = title === "Asia/Pacific" ? "asiaPacific" : title.toLowerCase();
  return <>
    <TableRow className="bg-[var(--terminal-surface)]">
      <TableCell className={cn("sticky left-0 bg-[var(--terminal-surface)] px-2 py-1 text-left font-bold", "w-[120px] sm:w-[140px] whitespace-nowrap overflow-hidden text-ellipsis")}>
        {sectionNum} {title}
      </TableCell>
      <TableCell colSpan={9} />
    </TableRow>
    {items.length ? items.map(item => <MarketRow key={item.id} item={item} region={region} isDarkMode={isDarkMode}
      updatedCells={updatedCells} updatedSparklines={updatedSparklines} />) : <TableRow>
      <TableCell colSpan={10} className="text-center py-3 text-xs text-[var(--terminal-textSecondary)]">{emptyMessage}</TableCell>
    </TableRow>}
  </>;
}

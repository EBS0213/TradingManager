"use client";
import { TableCell } from "@/components/ui/table";
import { useAtom } from "jotai";
import { show10DAtom } from "../atoms";
import { bloombergColors, cn } from "../lib/theme-config";
import type { MarketItem } from "../types";
import { Sparkline } from "./sparkline";
export function SparklineCell({ item, isDarkMode, isHighlighted }: { item: MarketItem; region: string; isDarkMode: boolean; isHighlighted: boolean }) {
  const [show10D] = useAtom(show10DAtom);
  const colors = isDarkMode ? bloombergColors.dark : bloombergColors.light;
  const first = (show10D ? item.historicalData10D : item.sparkline1) || [];
  const second = show10D ? [] : item.sparkline2 || [];
  return <TableCell className={cn("px-2 py-1 w-[100px] relative", isHighlighted && "bg-yellow-900")}>
    <div className="flex justify-center" title={first.length > 1 ? "수집된 관측 데이터" : "해당 구간의 관측 데이터가 없습니다"}>
      {first.length > 1 ? <Sparkline data1={first} data2={second} width={80} height={20} color1={colors.sparklineGray} color2={item.change > 0 ? colors.positive : colors.negative} /> : <span className="text-gray-500">—</span>}
    </div>
  </TableCell>;
}

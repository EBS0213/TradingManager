"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAtom } from "jotai";
import { useEffect } from "react";
import { ChevronDown } from "lucide-react";
import {
  show10DAtom,
  showAvatAtom,
  showCADAtom,
  showFuturesAtom,
  showMoversAtom,
  showRatiosAtom,
  showVolatilityAtom,
  showYTDAtom,
} from "../atoms";
import { activeWatchlistAtom } from "../atoms/terminal-ui";
import { BloombergButton } from "../core/bloomberg-button";
import { bloombergColors } from "../lib/theme-config";
import type { MarketData } from "../types";
import { marketFilterSupport } from "../lib/market-filters";

type TerminalFilterBarProps = {
  isDarkMode: boolean;
  watchlists: Array<{ name: string; indices: string[] }>;
  data?: MarketData;
};

export function TerminalFilterBar({ isDarkMode, watchlists, data }: TerminalFilterBarProps) {
  const colors = isDarkMode ? bloombergColors.dark : bloombergColors.light;

  // Use Jotai atoms directly for state management
  const [showMovers, setShowMovers] = useAtom(showMoversAtom);
  const [showVolatility, setShowVolatility] = useAtom(showVolatilityAtom);
  const [showRatios, setShowRatios] = useAtom(showRatiosAtom);
  const [showFutures, setShowFutures] = useAtom(showFuturesAtom);
  const [showAvat, setShowAvat] = useAtom(showAvatAtom);
  const [show10D, setShow10D] = useAtom(show10DAtom);
  const [showYTD, setShowYTD] = useAtom(showYTDAtom);
  const [showCAD, setShowCAD] = useAtom(showCADAtom);
  const [activeWatchlist, setActiveWatchlist] = useAtom(activeWatchlistAtom);
  const support = marketFilterSupport(data);
  useEffect(() => {
    if (!data) return;
    if (!support.movers) setShowMovers(false);
    if (!support.volatility) setShowVolatility(false);
    if (!support.ratios) setShowRatios(false);
    if (!support.futures) setShowFutures(false);
  }, [data, support.movers, support.volatility, support.ratios, support.futures, setShowMovers, setShowVolatility, setShowRatios, setShowFutures]);

  return (
    <div
      className={`flex flex-wrap items-center gap-2 bg-[var(--terminal-surface)] px-2 py-1 text-[var(--terminal-accent)] text-xs sm:text-sm`}
    >
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-1">
          <span className="font-bold">{activeWatchlist ? activeWatchlist : "Standard"}</span>
          <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent style={{ backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }} className="font-mono text-xs">
          <DropdownMenuItem onClick={() => setActiveWatchlist(null)}>Standard</DropdownMenuItem>
          {watchlists.map((list) => (
            <DropdownMenuItem key={list.name} onClick={() => setActiveWatchlist(list.name)}>
              {list.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-1">
        <Checkbox
          id="movers"
          checked={showMovers && support.movers}
          disabled={!support.movers}
          onCheckedChange={(checked) => setShowMovers(!!checked)}
          className="h-3 w-3 rounded-none border-gray-500 data-[state=checked]:bg-gray-500"
        />
        <label htmlFor="movers">Movers</label>
      </div>

      <div className={`flex items-center gap-1 ${!support.volatility ? "opacity-50" : ""}`} title={!support.volatility ? "MKT 필터용 변동성 값이 제공되지 않습니다. 일별 변동성 분석은 GVOL에서 확인하세요." : "변동성 10 초과"}>
        <Checkbox
          id="volatility"
          checked={showVolatility && support.volatility}
          disabled={!support.volatility}
          onCheckedChange={(checked) => setShowVolatility(!!checked)}
          className="h-3 w-3 rounded-none border-gray-500 data-[state=checked]:bg-gray-500"
        />
        <label htmlFor="volatility">Volatility</label>
        {!support.volatility && <span className="text-[9px]" aria-hidden="true">미지원</span>}
      </div>

      <div className={`flex items-center gap-1 ${!support.ratios ? "opacity-50" : ""}`} title={!support.ratios ? "현재 지수 데이터에 PER 정보가 없어 사용할 수 없습니다." : "PER 정보가 있는 항목"}>
        <Checkbox
          id="ratios"
          checked={showRatios && support.ratios}
          disabled={!support.ratios}
          onCheckedChange={(checked) => setShowRatios(!!checked)}
          className="h-3 w-3 rounded-none border-gray-500 data-[state=checked]:bg-gray-500"
        />
        <label htmlFor="ratios">Ratios</label>
        {!support.ratios && <span className="text-[9px]" aria-hidden="true">미지원</span>}
      </div>

      <div className={`flex items-center gap-1 ${!support.futures ? "opacity-50" : ""}`} title={!support.futures ? "현재 글로벌 지수 표에는 선물 시세가 없습니다. 원자재 선물은 경제 데이터에서 확인하세요." : "선물 항목만 표시"}>
        <Checkbox
          id="futures"
          checked={showFutures && support.futures}
          disabled={!support.futures}
          onCheckedChange={(checked) => setShowFutures(!!checked)}
          className="h-3 w-3 rounded-none border-gray-500 data-[state=checked]:bg-gray-500"
        />
        <label htmlFor="futures">Futures</label>
        {!support.futures && <span className="text-[9px]" aria-hidden="true">미지원</span>}
      </div>

      <div className="flex items-center gap-1">
        <Checkbox
          id="avat"
          checked={showAvat}
          onCheckedChange={(checked) => setShowAvat(!!checked)}
          className="h-3 w-3 rounded-none border-gray-500 data-[state=checked]:bg-gray-500"
        />
        <label htmlFor="avat">Δ AVAT</label>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <BloombergButton color={show10D ? "green" : "red"} className="flex items-center gap-1">
            <span>10D</span>
            <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4" />
          </BloombergButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent style={{ backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }} className="font-mono text-xs">
          <DropdownMenuItem onClick={() => setShow10D(false)}>Off</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShow10D(true)}>10D</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <BloombergButton color={showYTD ? "green" : "red"} className="flex items-center gap-1">
            <span>%Chg {showYTD ? "YTD" : "Daily"}</span>
            <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4" />
          </BloombergButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent style={{ backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }} className="font-mono text-xs">
          <DropdownMenuItem onClick={() => setShowYTD(false)}>Daily Change</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowYTD(true)}>%Chg YTD</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <BloombergButton color={showCAD ? "green" : "red"} className="flex items-center gap-1">
            <span>{showCAD ? "CAD*" : "NATIVE"}</span>
            <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4" />
          </BloombergButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent style={{ backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }} className="font-mono text-xs">
          <DropdownMenuItem onClick={() => setShowCAD(false)}>원래 단위</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowCAD(true)}>CAD · USD 가격만 예시 환율 적용</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

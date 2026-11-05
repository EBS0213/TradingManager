"use client";

import { useAtom, useSetAtom } from "jotai";
import { useMemo } from "react";
import { activeWatchlistAtom, addWatchlistAtom, closeConfirmModalAtom, confirmAndCloseModalAtom,
  confirmModalPropsAtom, isConfirmModalOpenAtom, isWatchlistOpenAtom, openConfirmModalAtom,
  resetFiltersAtom, watchlistsAtom } from "../atoms/terminal-ui";
import { ConfirmationModal } from "../core/confirmation-modal";
import { ShortcutsHelp } from "../core/keyboard-shortcuts";
import { Watchlist } from "../core/watchlist";
import { useTerminalUI, useMarketDataQuery } from "../hooks";
import { TerminalFilterBar } from "./terminal-filter-bar";
import { TerminalHeader } from "./terminal-header";
import { TerminalLayout } from "./terminal-layout";
import MarketMoversView from "../views/market-movers-view";
import { MarketView } from "../views/market-view";
import NewsView from "../views/news-view";
import { RmiView } from "../views/rmi-view";
import VolatilityView from "../views/volatility-view";

export default function BloombergTerminal() {
  const { isDarkMode, currentView, setCurrentView, isShortcutsHelpOpen, setIsShortcutsHelpOpen,
    handleThemeToggle, handleMarketView, handleNewsView, handleMoversView, handleVolatilityView,
    handleRmiView, handleHelpClick } = useTerminalUI();
  const [isConfirmModalOpen] = useAtom(isConfirmModalOpenAtom);
  const [confirmModalProps] = useAtom(confirmModalPropsAtom);
  const [isWatchlistOpen, setIsWatchlistOpen] = useAtom(isWatchlistOpenAtom);
  const [watchlists] = useAtom(watchlistsAtom);
  const setActiveWatchlist = useSetAtom(activeWatchlistAtom);
  const resetFilters = useSetAtom(resetFiltersAtom);
  const openConfirmModal = useSetAtom(openConfirmModalAtom);
  const closeConfirmModal = useSetAtom(closeConfirmModalAtom);
  const confirmAndCloseModal = useSetAtom(confirmAndCloseModalAtom);
  const addWatchlist = useSetAtom(addWatchlistAtom);
  const { marketData: data, refreshData, toggleRealTimeUpdates, isLoading, error } = useMarketDataQuery();
  const allMarketIndices = useMemo(() => [data?.americas, data?.emea, data?.asiaPacific].flatMap((items) => items?.map((item) => item.id) || []), [data]);
  const handleCancel = () => { closeConfirmModal(); setIsWatchlistOpen(false); setIsShortcutsHelpOpen(false); setCurrentView("market"); };
  const handleReset = () => openConfirmModal({ title: "Reset filters", message: "모든 필터와 관심목록 선택을 초기화할까요? 저장된 관심목록은 유지됩니다.", onConfirm: () => { resetFilters(); setActiveWatchlist(null); } });
  const shortcuts = [
    { key: "n", ctrlKey: true, action: () => setIsWatchlistOpen(true), description: "Create watchlist" },
    { key: "b", ctrlKey: true, action: handleReset, description: "Reset filters" },
    { key: "Escape", action: handleCancel, description: "Return to market" },
    { key: "r", ctrlKey: true, action: refreshData, description: "Refresh market data" },
    { key: "l", ctrlKey: true, action: toggleRealTimeUpdates, description: "Toggle polling" },
    { key: "1", action: handleMarketView, description: "Market" },
    { key: "2", action: handleNewsView, description: "News" },
    { key: "3", action: handleMoversView, description: "Market movers" },
    { key: "4", action: handleVolatilityView, description: "Volatility" },
    { key: "5", action: handleRmiView, description: "Relative Market Index" },
    { key: "?", action: handleHelpClick, description: "Keyboard shortcuts" },
  ];
  const emptyData = { americas: [], emea: [], asiaPacific: [] };
  return <TerminalLayout shortcuts={shortcuts} shortcutsEnabled={!isConfirmModalOpen && !isWatchlistOpen && !isShortcutsHelpOpen}>
    <TerminalHeader isDarkMode={isDarkMode} currentView={currentView} onMarketClick={handleMarketView}
      onCancelClick={handleCancel} onNewClick={() => setIsWatchlistOpen(true)} onBlancClick={handleReset}
      onNewsClick={handleNewsView} onMoversClick={handleMoversView} onVolatilityClick={handleVolatilityView}
      onRmiClick={handleRmiView} onHelpClick={handleHelpClick} onThemeToggle={handleThemeToggle} />
    {currentView === "market" && <><TerminalFilterBar isDarkMode={isDarkMode} watchlists={watchlists} data={data} /><MarketView isDarkMode={isDarkMode} /></>}
    {currentView === "news" && <NewsView isDarkMode={isDarkMode} onBack={handleMarketView} />}
    {(currentView === "movers" || currentView === "volatility") && error && <p role="alert" className="p-2 text-red-400">시장 데이터를 불러오지 못했습니다. REFR로 다시 시도하세요.</p>}
    {currentView === "movers" && <MarketMoversView isDarkMode={isDarkMode} onBack={handleMarketView} marketData={data || emptyData} onRefresh={refreshData} isLoading={isLoading} />}
    {currentView === "volatility" && <VolatilityView isDarkMode={isDarkMode} onBack={handleMarketView} marketData={data || emptyData} onRefresh={refreshData} isLoading={isLoading} />}
    {currentView === "rmi" && <RmiView />}
    <ConfirmationModal isOpen={isConfirmModalOpen} onClose={closeConfirmModal} onConfirm={confirmAndCloseModal}
      title={confirmModalProps.title} message={confirmModalProps.message} isDarkMode={isDarkMode} />
    <Watchlist isOpen={isWatchlistOpen} onClose={() => setIsWatchlistOpen(false)} isDarkMode={isDarkMode}
      marketIndices={allMarketIndices} onSave={addWatchlist} />
    <ShortcutsHelp shortcuts={shortcuts} isOpen={isShortcutsHelpOpen} onClose={() => setIsShortcutsHelpOpen(false)} isDarkMode={isDarkMode} />
  </TerminalLayout>;
}

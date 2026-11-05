import type { FilterState, MarketData, MarketItem } from "../types";

export function marketItems(data?: MarketData): MarketItem[] {
  return [data?.americas, data?.emea, data?.asiaPacific].flatMap(items => Array.isArray(items) ? items : []);
}

export function marketFilterSupport(data?: MarketData) {
  const items = marketItems(data);
  return {
    movers: items.some(item => Number.isFinite(item.pctChange)),
    volatility: items.some(item => Number.isFinite(item.volatility)),
    ratios: items.some(item => Number.isFinite(item.peRatio)),
    futures: items.some(item => item.isFuture === true),
  };
}

// Capabilities are checked across the entire feed, before watchlists or regions.
// A previously selected unsupported filter must not hide all ordinary indices.
export function supportedMarketFilters(filters: FilterState, data?: MarketData) {
  const support = marketFilterSupport(data);
  return {
    ...filters,
    showMovers: filters.showMovers && support.movers,
    showVolatility: filters.showVolatility && support.volatility,
    showRatios: filters.showRatios && support.ratios,
    showFutures: filters.showFutures && support.futures,
  };
}

export function filterMarketItems(items: MarketItem[], filters: FilterState): MarketItem[] {
  return items.filter(item =>
    (!filters.showMovers || (Number.isFinite(item.pctChange) && Math.abs(item.pctChange) > 1)) &&
    (!filters.showVolatility || (Number.isFinite(item.volatility) && item.volatility! > 10)) &&
    (!filters.showRatios || Number.isFinite(item.peRatio)) &&
    (!filters.showFutures || item.isFuture === true)
  );
}

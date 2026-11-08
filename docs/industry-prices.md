# Data workspace: dashboard, DRAM and international oil

The Data navigation order is **Economics → DRAM → 원유 → 항공 → 해상·운임**.
DRAM and oil are sibling pages of Economics, with independent hashes
`/#terminal/dram` and `/#terminal/oil`. Data Sources is immediately after Portfolio
in the main navigation. Countries is retired; existing hashes resolve to Economics.

## Economics

The default dashboard displays every supplied indicator as a card, grouped by
subject: growth, prices, employment, consumption, production, housing, liquidity,
fiscal/trade, markets, policy rates, bond yields, spreads, mortgages, FX and
commodities. No six-card limit or scrolling inventory table hides remaining items.
Category checkboxes, subgroup, country, availability, text search and sorting all
filter the same dashboard. Missing values remain visible by default. Zero is not
missing. Published future-dated values are labelled future reference dates.
Legacy oil/mortgage rows are assigned to commodity/rates filters by instrument.
Each card opens a keyboard-accessible modal with its chart, table and CSV export.
The chart library loads only when detail is opened.

## DRAM and oil

DRAM displays all public chip, module and GDDR spot rows plus the public homepage
contract JSON feed. Member-only LPDDR/mobile placeholders are excluded, including from older cached snapshots. Only public price categories are shown; genuine missing public observations still retain their unavailable state.
MemoryMarket public tables supplement these with 36 chip/module/LPDDR quotes:
8 DDR chips, 6 RDIMM, 9 UDIMM, 4 SODIMM and 9 LPDDR4X/LPDDR5X items. They use
latest/previous/change columns, not inferred spot-session ranges or OEM contracts.
Product, capacity, speed and chip-grade names remain unchanged. No provider labels,
links or provider-specific tabs are added to the app; provenance stays in the
backend for validation. The supplemental provider is excluded from the Data Sources
listing per the user's explicit display preference. Each quote retains its actual
UTC publication timestamp and USD-per-item unit. Missing categories, masked cells,
invalid dates and changed currencies reject a new snapshot; the independent cache
keeps previous valid data on failure. This feed uses the existing hourly cache and
automatic startup/15-minute collection cycle; no login or credentials are needed.

The parser identifies price links because the upstream reuses HTML table IDs.
Spot tables preserve period/session highs, lows, averages, percent moves and source
time. Contract prices preserve their publication period. Nothing is inferred from
masked cells or rounded percent moves.

Oil displays Dubai spot, Brent/WTI futures and seven international petroleum
products in USD/barrel. The separate won/litre tables are excluded. Latest quotes
remain a compact endpoint. A separate history endpoint stores the official Opinet
CSV exports from 2008-01-01 onward, decoded with EUC-KR and validated by exact
product headers and dates. Missing cells and pre-launch products remain null. Signed observations, including
the -37.63 WTI settlement on 2020-04-20, remain real values.
A truncated recent-only file cannot replace a complete history.

The long-term chart supports crude/products, product selection, 1/3 months,
1/3/5 years, all dates, custom dates, daily prices and weekly/monthly/annual means.
Means use available observed daily prices; missing cells are excluded and zeros
are retained. Gaps are not interpolated. CSV downloads use the displayed filters.

## Automatic collection and persistence

Next.js instrumentation starts one background collection loop five seconds after
the local web server starts. It runs again fifteen minutes after completion, with
no overlap. The native app window need not be open; the local web service and the
computer must remain running. Shutdown/sleep cannot collect data; server restart
warms the cache again. This local loop is disabled on Vercel and during builds.

Each cycle checks Economics, DRAM/oil and oil history independently. Existing
PostgreSQL-backed caches and database refresh leases avoid redundant upstream
requests. Economics TTL is 15 minutes, BLS 12 hours, spot/latest oil 1 hour,
DRAM contract 12 hours and oil history 6 hours. Price data and collection status
are persisted locally; no personal database or copied source price files enter Git.
The status endpoint records actual start/completion times, next run, counts and
partial/unavailable outcomes. Expected member-only prices are not failures.
Clients poll for data every 15 minutes and the collection status every minute.
Data Sources polls its status queries every five minutes.

Manual refresh controls were removed from Economics, DRAM, oil and Data Sources
only after a real hands-off startup collection completed and saved both long-term
feeds. The UI shows automatic collection status and missing/stale states instead.

Endpoints:

- `/api/terminal/economy?view=overview`
- `/api/terminal/industry-prices?view=all|dram|oil`
- `/api/terminal/oil-history?kind=all|crude|products`
- `/api/terminal/data-status`

## Structure review and validation

Frontend: one dashboard/filter model and lazy chart modules; no server CSV/HTML
parser is imported into the browser. Existing query infrastructure, styles and
source-attribution rules are reused. Chart modals restore focus on closing.
Backend: fixed upstream URLs, validated CSV headers/dates, null-preserving parsers,
2 MB response caps, 15-second latest/30-second history timeouts, isolated failures.
Full stack: observed date, collection time and automatic loop completion are
separate; absolute changes and percentage-point changes retain their actual units.
DevOps: no new dependency, schema migration, API key or OS-specific service.
Existing macOS/Windows CI discovers the new Node regression tests with `npm test`.

Verification on 2026-11-08:

- Related routing/price tests: 18 passed. Full web suite: 275 passed, 2 database-dependent tests skipped.
- TypeScript and production builds passed in the GitHub checkout and local runtime checkout.
- Automatic startup collection completed without loading any data screen: 167 economic indicators (152 with values, 15 unavailable), 19 public DRAM prices plus 11 member-only names, and 10 oil/product prices.
- Official historical CSV coverage: 2008-01-02 through 2026-11-06; crude 4,868 dates, products 4,724 dates. Low-sulfur diesel starts later and retains earlier nulls.
- Persistent status recorded start, completion and next run fifteen minutes later. The final local server completed a hands-off cycle at 18:31:57 KST and scheduled 18:46:57 KST.
- Native app verification confirmed all 167 cards, the sibling navigation order, FX-only filtering (21 items), FX + ECB search (4 items), detail chart/table, no refresh controls and the full-period/5-year oil chart.
- Daily-to-monthly product aggregation matched the official 2008-01 monthly table after rounding to the source precision; unintroduced diesel remained null.
- Tests cover filter intersections, legacy instrument classification, null/zero, CSV header/date failures, missing cells, period averages and the non-overlapping automatic timer.

Source publication times differ by series. Some Economics inputs rely on existing
FRED/ECOS collectors and may be unavailable or old even when the refresh cycle runs.
The previous local production build is retained for recovery during activation.

Verification for supplemental memory quotes (2026-11-09): 284 web tests passed,
2 database-dependent tests skipped; TypeScript and production builds passed in
both checkouts. The activated local API returned 55 priced DRAM items plus the
existing 11 restricted names and 10 oil items. Native app verification confirmed
all five new categories, LPDDR5X search with five quoted prices, original observed
dates and no supplemental-provider name on the price or Data Sources screen.

# DRAM and international oil prices

Data → DRAM shows every published row on the DRAMeXchange public homepage
(chip, module and GDDR spot) plus the homepage's public DRAM contract JSON feed.
LPDDR/mobile rows whose prices are masked by membership stay visible with null
values and `member_required`; the app neither bypasses membership nor estimates prices.
Data → International oil shows Opinet's three crude series (Dubai spot, Brent/WTI
futures) and seven international petroleum products, all in USD per barrel.
Opinet's separate won/litre table is deliberately excluded.

The public read-only endpoint is `/api/terminal/industry-prices?view=all|dram|oil`.
Each provider feed has its own failure boundary and existing PostgreSQL-backed
`cachedEconomy` cache. Spot/oil TTL is one hour; contract TTL is twelve hours.
Same-process singleflight and database refresh leases prevent duplicate upstream
requests. Source time and successful collection time are separate. The UI checks
its API every fifteen minutes while open. Closing the app does not schedule a new
external collector. New installations collect on first access without API keys.

A failed refresh preserves the last successfully saved feed and marks it stale.
An empty/malformed response cannot replace a valid feed with zeros. A cold failure
shows an explicit unavailable state. If PostgreSQL is unavailable, the existing
cache operates in memory. Age is recalculated on cache reads. The client provides
search, keyboard-accessible horizontal scrolling, prices, ranges, percent change,
observation date and availability. Provider links and collection details live on
Data Sources, positioned immediately after Portfolio in the main navigation.
Countries is removed; old Countries hashes resolve to Data.

## Implementation review

- Frontend: reuse the terminal styles and query provider; request only the selected
  price view; remove the unused Countries/source UI branch from EconomyHub.
- Backend: strict source-specific parsers, fixed upstream URLs, bounded responses
  (2 MB/15 seconds), independent feeds, no caller-supplied remote URL.
- Full stack: one normalized contract retains null vs zero, source date vs fetch
  date, USD/item vs USD/barrel and absolute vs percent changes.
- DevOps: no new service, credentials, dependency, schema migration or OS-specific
  scheduler. Cross-platform Node regression tests are included in `npm test` and
  the existing macOS/Windows CI. Live browser verification uses real source data;
  offline regression fixtures test duplicate DOM ids, malformed tables, missing
  newest cells, membership masking, feed isolation and retired navigation.

Run `node --test tests/industry-prices.test.mjs tests/terminal-economy-cache.test.mjs`
from `web/`, then `npm run build`. Price data stays in the user's database and is
not committed to GitHub. Source publication times can differ substantially by group.

## Verification — 2026-11-08

| Boundary | Evidence |
| --- | --- |
| Build and types | Production build and TypeScript checks passed in the GitHub checkout and local runtime checkout. |
| Automated regression | 256 passed, 2 database-dependent tests skipped; includes 8 new industry-price cases and 8 existing cache cases. |
| Upstream → parser → API | Real response: 19 public DRAM prices, 11 member-only names, 3 crude and 7 petroleum product prices; all four feeds available. |
| Persistence → restart | Local production service rebuilt and restarted; the same successful collection timestamp was read back from the PostgreSQL cache. |
| API → native app | Running TradingManager macOS app visibly rendered DDR5 chip 60.167, Dubai 96.30 and all product rows with their actual source dates. |
| Search | Typing 경유 reduced the product table to exactly the two sulfur grades. |
| Sources and navigation | DATA SOURCES appeared immediately after Portfolio; Opinet and DRAMeXchange showed received status and collection details; Countries absent. |

The local old production build was saved before replacement. No new credentials,
OS service, database migration or package dependency was needed. The running app
was refreshed after the production build replacement to load its new chunks.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Current product direction — 2026-10-21

- The user explicitly retired the Naver Pay-style design requirement. Do not use Naver Pay layouts or styling as the product reference.
- Use the Fincept Terminal module and compact multi-panel workspace structure as the current design reference. Use the TradingManager brand; implement the web UI independently of Fincept's native C++/Qt code and assets.
- Terminal is the default area: expose market, equity, sector ETF, crypto, FX, commodity, rates, economics, news, research, earnings, and data-source tools with actual data and explicit unavailable states.
- Trading remains separately selectable and contains the existing screening, chart game, journal, setup, watchlist, and guide workflows.
- This design change does not remove Naver as a market-data provider. Show provider, currency, observation time, and delayed/stale status accurately. Do not fabricate missing financial metrics or expose unimplemented buttons as working tools.

## UI follow-up — 2026-10-23

- Keep provider attribution and data-collection explanations on the Data Sources page (`/#terminal/sources`). Do not add source links or explanatory footers to individual cards, charts, or tables. Keep actual data values, units, timestamps, and operational missing/error states.
- Trading navigation order: 01 Screening, 02 Setup, 03 Ryan guide, 04 Journal, 05 Watchlist, 06 Chart game.
- In chart training, keep Training and Scoreboard on the left; group My Records and Save Records together on the right. Save unfinished sessions separately from completed leaderboard entries.

- Chart game navigation uses one unified button in the session settings panel above Apply: Next Question while a session is unfinished (enabled after the current result), New Game before a session or after all 10 questions. Do not restore a separate Next Question button below the chart.

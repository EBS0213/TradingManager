# Third-party sources

## Bloomberg Terminal Clone

The terminal components are adapted from https://github.com/feremabraz/bloomberg-terminal.
The upstream README declares MIT licensing; the referenced checkout does not contain a separate LICENSE or copyright notice. Original source comments are retained.

TM26 adaptations include its terminal/trading workspace, data services, persistent watchlists, actual observation based RMI, accessibility fixes, and explicit data availability states. This is an independent TM26 interface; it does not claim affiliation with Bloomberg or provide Bloomberg proprietary data.

## TradingView Lightweight Charts

The existing trading application uses Lightweight Charts 5.2.1 under Apache-2.0. See `public/screener/lwc-LICENSE.txt`.

## FinceptTerminal data-source reference

The economic data hub takes inspiration from the provider categories and connector catalogue in https://github.com/Fincept-Corporation/FinceptTerminal, reviewed at commit `3d8617cae3f13c93874d4bee4fb0f2846e9c83bc` on 2026-10-21.

FinceptTerminal is a separate desktop product. Its README states AGPL-3.0-or-later; its LICENSE also contains additional usage conditions. No Fincept source code, interface assets, or runtime is incorporated into TM26. The TM26 adapters and interface are independently written against public data-provider HTTP contracts. This is not a full port of FinceptTerminal or an official Fincept service.

Sources currently implemented: World Bank Indicators API (with IMF WEO DataMapper fallback), U.S. Bureau of Labor Statistics Public Data API, U.S. Treasury daily par yields, ECB reference exchange rates via Frankfurter, and publicly accessible Naver Finance market indicators. Existing TM26 FRED and Bank of Korea ECOS observations are retained with their original dates and explicit availability states. Provider dates, units, source links, and stale or unavailable status are displayed alongside data. IMF estimates, delayed futures quotes, and reference exchange rates are identified separately. Fincept Cloud is not connected.

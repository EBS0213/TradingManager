const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const baseURL = process.env.BASE_URL || process.argv[2] || 'http://localhost:3126';
const artifacts = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const checks = [], errors = [], observations = {};
  page.on('pageerror', error => errors.push(error.message));
  const check = (name, value = true) => { assert(value, name); checks.push(name); console.log('PASS', name); };
  const marketRows = () => page.getByRole('button', { name: / RMI 분석$/ });
  const waitForRows = async count => {
    await page.waitForFunction(expected =>
      [...document.querySelectorAll('[role="button"][aria-label], button[aria-label]')].filter(button => / RMI 분석$/.test(button.getAttribute('aria-label'))).length === expected,
    count, { timeout: 15000 });
  };
  const createWatchlist = async (name, symbol) => {
    await page.getByRole('button', { name: 'NEW', exact: true }).click();
    await page.getByLabel('관심목록 이름').fill(name);
    if (symbol) await page.getByRole('checkbox', { name: symbol, exact: true }).check();
    await page.getByRole('button', { name: 'SAVE', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).waitFor();
  };

  try {
    const responsePromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/terminal/market-data' && !url.searchParams.has('history');
    }, { timeout: 60000 });
    await page.goto(new URL('/#terminal/analytics', baseURL).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const response = await responsePromise;
    const data = await response.json();
    const items = ['americas', 'emea', 'asiaPacific'].flatMap(region => data[region] || []);
    observations.snapshot = {
      status: response.status(), count: items.length,
      priced: items.filter(item => typeof item.value === 'number' && Number.isFinite(item.value)).length,
      unsupportedFields: {
        Futures: items.filter(item => typeof item.isFuture === 'boolean').length,
        Ratios: items.filter(item => typeof item.peRatio === 'number' && Number.isFinite(item.peRatio)).length,
        Volatility: items.filter(item => typeof item.volatility === 'number' && Number.isFinite(item.volatility)).length,
      },
    };
    check('market API contains priced observations', response.ok() && observations.snapshot.priced > 0);
    await waitForRows(items.length);
    check('default market shows all source rows', await marketRows().count() === items.length);

    for (const [name, fieldCount] of Object.entries(observations.snapshot.unsupportedFields)) {
      if (fieldCount !== 0) { observations[name] = 'Source now provides this field; unsupported-state assertion skipped.'; continue; }
      const checkbox = page.getByRole('checkbox', { name, exact: true });
      check(`${name} is disabled without source support`, await checkbox.isDisabled());
      check(`${name} remains unchecked`, !await checkbox.isChecked());
      // Playwright follows the associated disabled control; force targets the label's actual click area.
      await page.locator(`label[for="${name.toLowerCase()}"]`).click({ force: true });
      check(`${name} label cannot remove rows`, !await checkbox.isChecked() && await marketRows().count() === items.length);
    }
    await page.screenshot({ path: path.join(artifacts, 'terminal-filter-supported-state.png'), fullPage: true });

    // Use a real quiet quote for a deterministic empty Movers result within a one-symbol watchlist.
    const quiet = items.filter(item => typeof item.value === 'number' && Number.isFinite(item.value)
      && typeof item.pctChange === 'number' && Number.isFinite(item.pctChange) && Math.abs(item.pctChange) < 0.8)
      .sort((a, b) => Math.abs(a.pctChange) - Math.abs(b.pctChange))[0];
    assert(quiet, 'A real priced quote below 0.8% is required for the zero-result Movers scenario; no market values are fabricated.');
    observations.quietQuote = { id: quiet.id, pctChange: quiet.pctChange, asOf: quiet.asOf || quiet.time };
    await page.getByRole('checkbox', { name: 'Δ AVAT', exact: true }).uncheck();
    await createWatchlist('QA FILTER QUIET', quiet.id);
    await waitForRows(1);
    check('watchlist narrows to the chosen real quote', await marketRows().count() === 1);
    await page.getByRole('checkbox', { name: 'Movers', exact: true }).check();
    await waitForRows(0);
    check('Movers can have a genuine zero result', await page.getByText('선택한 필터 조건에 맞는 지수가 없습니다.', { exact: true }).count() > 0);
    await page.screenshot({ path: path.join(artifacts, 'terminal-filter-movers-empty.png'), fullPage: true });
    await page.getByRole('button', { name: '전체 지수 보기', exact: true }).click();
    await waitForRows(items.length);
    check('clear restores all indices and Standard watchlist', await page.getByRole('button', { name: 'Standard', exact: true }).isVisible());
    check('clear resets Movers', !await page.getByRole('checkbox', { name: 'Movers', exact: true }).isChecked());
    check('clear preserves column preferences', !await page.getByRole('checkbox', { name: 'Δ AVAT', exact: true }).isChecked());

    await createWatchlist('QA FILTER EMPTY');
    await waitForRows(0);
    check('empty watchlist has an explicit explanation', await page.getByText(/관심목록에 표시할 지수가 없습니다\./).isVisible());
    check('empty regions identify watchlist filtering', await page.getByText('관심목록에 이 지역의 지수가 없습니다.', { exact: true }).count() > 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifacts, 'terminal-filter-empty-mobile.png'), fullPage: true });
    check('empty-state mobile page fits', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.getByRole('button', { name: '전체 지수 보기', exact: true }).click();
    await waitForRows(items.length);
    check('empty watchlist clear restores all indices', await marketRows().count() === items.length);
    await page.getByRole('button', { name: 'Standard', exact: true }).click();
    check('clear preserves both saved watchlists', await page.getByRole('menuitem', { name: 'QA FILTER EMPTY', exact: true }).count() === 1
      && await page.getByRole('menuitem', { name: 'QA FILTER QUIET', exact: true }).count() === 1);
    await page.keyboard.press('Escape');
    check('no browser runtime errors', errors.length === 0);
  } finally {
    fs.writeFileSync(path.join(artifacts, 'terminal-filter-smoke.json'), JSON.stringify({ baseURL, checks, errors, observations, url: page.url() }, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });

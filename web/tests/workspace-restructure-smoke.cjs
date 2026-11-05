const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.argv[2] || 'http://localhost:3126';
const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname);
const output = '/private/tmp/tm26-workspace-restructure';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], checks = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  const check = (name, value) => { assert(value, name); checks.push(name); console.log('PASS', name); };
  try {
    if (local) {
      await page.route(url => url.pathname === '/api/brief' && url.searchParams.get('view') === 'dashboard', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: [{ day: '2026-10-22', slot: 'mid', at: '12:00', title: '장중 브리핑', text: '<b>한눈에</b>\n시장 현황을 점검합니다.' }] }) }));
      await page.route(url => url.pathname === '/api/screener/latest' && url.searchParams.get('symbol') === '005930', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, market: 'KR', symbol: '005930', stamp: '2026-10-22 14:04', row: { '코드': '005930', '종합점수': 82, '점수내역': '[12,12,5,10,10,9,9,7,8]', '통과개수': 8, 'RS': 91, '판정': '통과', '편입상태': '유지', '잔류일': 18, '실적판정': '충족' } }) }));
    }
    await page.goto(`${base}/#terminal/overview`, { waitUntil: 'domcontentloaded', timeout: 65000 });
    const primary = page.getByRole('navigation', { name: '터미널 주요 메뉴' });
    await primary.getByRole('button', { name: '지수', exact: true }).waitFor();
    check('primary menu groups are ordered', JSON.stringify(await primary.locator('button').allTextContents()) === JSON.stringify(['지수', '주식', '뉴스', '리서치', '컨퍼런스', '게시판', '포트폴리오']));
    check('duplicate breadcrumb is removed', await page.locator('.fc-panel-tab').count() === 0);
    await page.getByRole('region', { name: '시장 브리핑' }).getByRole('combobox', { name: '브리핑 선택' }).waitFor();
    check('dashboard owns the briefing', await page.getByRole('region', { name: '시장 브리핑' }).isVisible());
    check('dashboard wire omits time cells', await page.locator('.fc-news-wire time').count() === 0);
    await page.screenshot({ path: `${output}/dashboard.png`, fullPage: true });

    await primary.getByRole('button', { name: '주식', exact: true }).click();
    await page.getByRole('heading', { name: '주식 모니터' }).waitFor();
    check('company search is absent from navigation', await page.getByRole('navigation', { name: '주식 세부 메뉴' }).getByText('기업 검색').count() === 0);
    await page.getByLabel('조회 시장', { exact: true }).selectOption('KR');
    await page.getByRole('searchbox', { name: '종목 검색', exact: true }).fill('005930');
    await page.getByRole('button', { name: '005930', exact: true }).waitFor();
    await page.getByRole('button', { name: '005930', exact: true }).click();
    await page.getByRole('tab', { name: '트레이딩' }).waitFor();
    await page.getByRole('tab', { name: '트레이딩' }).click();
    await page.getByRole('region', { name: '005930 트레이딩 점수' }).getByText('종합점수').waitFor();
    check('stock trading tab contains screening score', await page.getByRole('region', { name: '005930 트레이딩 점수' }).locator('strong[data-grade]').isVisible() && (await page.getByRole('region', { name: '005930 트레이딩 점수' }).locator('strong[data-grade]').innerText()) !== '—/100');
    await page.screenshot({ path: `${output}/trading-score.png`, fullPage: true });

    await primary.getByRole('button', { name: '뉴스', exact: true }).click();
    await page.getByRole('navigation', { name: '터미널 주요 메뉴' }).getByRole('button', { name: '뉴스', exact: true }).waitFor();
    const feed = page.getByRole('region', { name: '뉴스 피드' });
    check('news feed header has publisher and title only', JSON.stringify(await feed.locator('div').first().locator('span').allTextContents()) === JSON.stringify(['언론사·채널', '기사 제목']));
    check('news feed rows omit time cells', await feed.locator('button time').count() === 0);
    check('news filters omit Telegram', await page.getByRole('button', { name: '텔레그램', exact: true }).count() === 0);

    await primary.getByRole('button', { name: '리서치', exact: true }).click();
    const researchTabs = page.getByRole('tablist', { name: '리서치 유형' });
    await researchTabs.waitFor();
    check('research is limited to company and strategy', JSON.stringify(await researchTabs.getByRole('tab').allTextContents()) === JSON.stringify(['기업', '전략']));
    await primary.getByRole('button', { name: '컨퍼런스', exact: true }).click();
    const conference = page.getByRole('navigation', { name: '컨퍼런스콜 보기' });
    await conference.waitFor();
    check('calls and earnings calendar share one page', JSON.stringify(await conference.locator('button').allTextContents()) === JSON.stringify(['컨퍼런스콜', '실적 일정']));
    await conference.getByRole('button', { name: '실적 일정' }).click();
    check('calendar opens without leaving conference route', page.url().includes('#terminal/calls') && await page.locator('[aria-label="발표 예정일 선택"]').isVisible());
    await page.screenshot({ path: `${output}/conference-calendar.png`, fullPage: true });

    await primary.getByRole('button', { name: '포트폴리오', exact: true }).click();
    const portfolioNav = page.getByRole('navigation', { name: '포트폴리오 세부 메뉴' });
    await portfolioNav.waitFor();
    check('portfolio and watchlist are grouped beside forum', JSON.stringify(await portfolioNav.locator('button').allTextContents()) === JSON.stringify(['포트폴리오PORTFOLIO', '관심 자산WATCHLIST']));
    await primary.getByRole('button', { name: '컨퍼런스', exact: true }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    check('mobile conference page has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check('browser has no runtime errors', errors.length === 0);
    fs.writeFileSync(`${output}/result.json`, JSON.stringify({ base, checks, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });

const assert = require('node:assert/strict');
const {chromium} = require('playwright-core');

(async () => {
  const base = process.env.SITE_URL;
  assert.equal(new URL(base).hostname, '127.0.0.1');
  const response = await fetch(base + '/api/screener/latest?market=KR');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.ok(data.result.length > 0);
  console.log('API verified:', data.result.length, data.stamp);
  const job = await fetch(base + '/api/screener/job', {
    headers: {'x-screener-key': process.env.SCREENER_KEY}, method: 'POST',
  });
  assert.equal(job.status, 200);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  });
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    await page.goto(base + '/#trading/dash', {waitUntil: 'domcontentloaded'});
    const table = page.getByRole('region', {name: '스크리닝 전체 판단 항목'});
    await table.locator('tbody tr').first().waitFor({timeout: 60000});
    const rows = await table.locator('tbody tr').count();
    const text = await table.locator('tbody').innerText();
    assert.ok(rows > 0 && text.length > 50);
    console.log(JSON.stringify({apiRows: data.result.length, stamp: data.stamp, visibleRows: rows,
      sample: text.slice(0, 220)}));
    await page.screenshot({path: '/tmp/tradingmanager-screener-installed.png'});
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

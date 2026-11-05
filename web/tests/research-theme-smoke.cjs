const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const baseURL = process.env.BASE_URL || process.argv[2] || 'http://localhost:3126';
const postId = Number(process.env.RESEARCH_POST_ID || 230);
const artifacts = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });

// Runs inside the isolated report document. Transparent canvas colors resolve through the iframe.
function reportPalette() {
  const rgb = color => (color.match(/[\d.]+/g) || []).map(Number);
  const luminance = color => {
    const c = rgb(color).slice(0, 3).map(value => {
      const x = value / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const background = element => {
    for (let node = element; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      const components = rgb(color);
      if (components.length === 3 || (components.length > 3 && components[3] > 0)) return color;
    }
    if (window.frameElement) {
      const color = window.parent.getComputedStyle(window.frameElement).backgroundColor;
      const components = rgb(color);
      if (components.length === 3 || (components.length > 3 && components[3] > 0)) return color;
    }
    return 'rgb(255, 255, 255)';
  };
  const entry = element => {
    if (!element) return null;
    const bg = background(element), color = getComputedStyle(element).color;
    const a = luminance(color), b = luminance(bg);
    return { color, background: bg, backgroundLuminance: b, contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  };
  return {
    body: entry(document.body), paragraph: entry(document.querySelector('p')),
    heading: entry(document.querySelector('h2')), subheading: entry(document.querySelector('h3')),
    tableHeader: entry(document.querySelector('th')), tableCell: entry(document.querySelector('td')),
    link: entry(document.querySelector('a[href]')),
    tables: document.querySelectorAll('table').length,
    content: [...document.querySelectorAll('h2,h3,p,th,td,a')].map(element => element.textContent.trim()),
    links: [...document.querySelectorAll('a[href]')].map(element => element.getAttribute('href')),
    viewport: { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const checks = [], errors = [], observations = {};
  page.on('pageerror', error => errors.push(error.message));
  const check = (name, value = true) => { assert(value, name); checks.push(name); console.log('PASS', name); };
  try {
    // Local development has no production DB credentials. Replay only the public
    // GET payload when explicitly requested; deployed checks always use the real API.
    if (process.env.RESEARCH_FIXTURE_FILE) {
      assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Fixtures are local-only');
      const fixture = fs.readFileSync(process.env.RESEARCH_FIXTURE_FILE, 'utf8');
      await page.route(`**/api/board/${postId}`, route => route.fulfill({ status: 200, contentType: 'application/json', body: fixture }));
    }
    const sourcePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/board/${postId}`, { timeout: 60000 });
    await page.goto(new URL(`/#terminal/research/${postId}`, baseURL).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const sourceResponse = await sourcePromise;
    const source = await sourceResponse.json();
    check('public report loads without login', sourceResponse.ok() && source.ok && typeof source.post?.body === 'string');
    const body = source.post.body;
    observations.source = { mode: process.env.RESEARCH_FIXTURE_FILE ? 'public GET replay (local only)' : 'live public API', id: source.post.id, title: source.post.title, author: source.post.author,
      bodySHA256: crypto.createHash('sha256').update(body).digest('hex'), bodyLength: body.length };
    const expected = await page.evaluate(raw => {
      const document = new DOMParser().parseFromString(raw, 'text/html');
      return { content: [...document.querySelectorAll('h2,h3,p,th,td,a')].map(element => element.textContent.trim()),
        tables: document.querySelectorAll('table').length,
        links: [...document.querySelectorAll('a[href]')].map(element => element.getAttribute('href')) };
    }, body);
    const app = page.frameLocator('iframe[title="TM26 트레이딩 및 리서치"]');
    const reportElement = app.locator('#bPost iframe.brep');
    const report = app.frameLocator('#bPost iframe.brep');
    await report.locator('h2').first().waitFor({ timeout: 30000 });
    check('report stays sandboxed without script permission',
      (await reportElement.getAttribute('sandbox')).includes('allow-same-origin') && !(await reportElement.getAttribute('sandbox')).includes('allow-scripts'));
    const initial = await report.locator('body').evaluate(reportPalette);
    observations.initial = initial;
    check('initial report already follows default dark theme', initial.body.backgroundLuminance < 0.15 && initial.body.contrast >= 4.5);

    for (const theme of ['dark', 'light', 'dark']) {
      await app.locator(`#thChips button[data-th="${theme}"]`).click();
      await page.waitForTimeout(200);
      const palette = await report.locator('body').evaluate(reportPalette);
      observations[`${theme}-${checks.length}`] = palette;
      check(`${theme} theme reaches report canvas`, theme === 'dark' ? palette.body.backgroundLuminance < 0.15 : palette.body.backgroundLuminance > 0.8);
      check(`${theme} body text remains readable`, palette.body.contrast >= 4.5 && (!palette.paragraph || palette.paragraph.contrast >= 4.5));
      check(`${theme} original report text and table content preserved`, JSON.stringify(palette.content) === JSON.stringify(expected.content));
      check(`${theme} original tables and links preserved`, palette.tables === expected.tables && JSON.stringify(palette.links) === JSON.stringify(expected.links));
      if (palette.tableHeader && palette.tableCell) check(`${theme} table header and cells remain readable`, palette.tableHeader.contrast >= 4.5 && palette.tableCell.contrast >= 4.5);
      await page.screenshot({ path: path.join(artifacts, `research-${postId}-${theme}-desktop.png`), fullPage: true });
    }

    await page.emulateMedia({ media: 'print' });
    const print = await report.locator('body').evaluate(reportPalette);
    observations.print = print;
    check('printing keeps original light document readable', print.body.backgroundLuminance > 0.8 && print.body.contrast >= 4.5);
    await page.emulateMedia({ media: 'screen' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const mobile = await report.locator('body').evaluate(reportPalette);
    observations.mobile = mobile;
    check('mobile report retains all text and table cells', JSON.stringify(mobile.content) === JSON.stringify(expected.content));
    check('mobile outer workspace does not overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check('mobile report frame fits its parent', await reportElement.evaluate(element => element.getBoundingClientRect().right <= element.ownerDocument.documentElement.clientWidth + 1));
    check('mobile report has readable dark text', mobile.body.backgroundLuminance < 0.15 && mobile.body.contrast >= 4.5);
    await page.screenshot({ path: path.join(artifacts, `research-${postId}-dark-mobile.png`), fullPage: true });

    // LEU contains no anchors. Exercise links through the real renderer in a local browser-only fixture.
    // No API mutation, saved report edit, navigation to links, or publishing occurs.
    if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await app.locator('body').evaluate(() => {
      const holder = document.createElement('div');
      holder.id = 'research-theme-test-fixture';
      holder.innerHTML = reportHTML('<!doctype html><html><head><style>body{background:#fff;color:#111}a{color:#0756b7}th{background:#111;color:#fff}td{background:#fff;color:#222}</style></head><body><h2>Theme QA fixture</h2><p><a href="https://example.com/research-source">Public source link</a></p><table><tr><th>Header</th></tr><tr><td>Original value</td></tr></table></body></html>');
      document.body.append(holder);
    });
    const fixture = app.frameLocator('#research-theme-test-fixture iframe.brep');
    await app.locator('#research-theme-test-fixture iframe.brep').scrollIntoViewIfNeeded();
    await fixture.getByRole('link', { name: 'Public source link' }).waitFor();
    for (const theme of ['light', 'dark']) {
      await app.locator(`#thChips button[data-th="${theme}"]`).click();
      await page.waitForTimeout(200);
      const palette = await fixture.locator('body').evaluate(reportPalette);
      observations[`linkFixture-${theme}`] = palette;
      check(`${theme} report link remains readable`, palette.link?.contrast >= 4.5);
      check(`${theme} link destination preserved`, palette.links[0] === 'https://example.com/research-source');
    }
    await app.locator('#research-theme-test-fixture').evaluate(element => element.remove());
    } else {
      observations.linkFixture = 'Local-only fixture skipped on deployed host; original public report links are preserved above.';
    }
    check('no browser runtime errors', errors.length === 0);
  } finally {
    fs.writeFileSync(path.join(artifacts, 'research-theme-smoke.json'), JSON.stringify({ baseURL, postId, checks, errors, observations, url: page.url() }, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });

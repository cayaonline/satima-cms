// Run against real frontend assets in an isolated browser; no database or live credentials.
// PLAYWRIGHT_MODULE may point to an existing Playwright index.mjs (no production dependency).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, extname } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const publicRoot = fileURLToPath(new URL('../../public/', import.meta.url));
const artifacts = resolve(process.env.NAV_SCREENSHOTS || fileURLToPath(new URL('../../test-results/navigation/', import.meta.url)));
let server, browser, origin;
before(async () => {
  await mkdir(artifacts, { recursive: true });
  // Serve unchanged shells, controllers and styles. API traffic is mocked per browser context.
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) { res.writeHead(500); res.end('Unmocked test API'); return; }
    const asset = Boolean(extname(pathname));
    const file = asset ? resolve(publicRoot, '.' + pathname) : join(publicRoot, pathname.startsWith('/operations') ? 'operations.html' : 'index.html');
    if (!file.startsWith(publicRoot)) { res.writeHead(403); res.end(); return; }
    try {
      res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
});
after(async () => { await browser?.close(); await new Promise(r => server ? server.close(r) : r()); });

async function openPortal(operations, viewport, reducedMotion = 'reduce') {
  const context = await browser.newContext({ viewport, reducedMotion });
  let signedIn = true;
  const requests = [], errors = [];
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ path: url.pathname, method: request.method() });
    if (url.pathname.endsWith('/logout')) { signedIn = false; return route.fulfill({ json: {} }); }
    if (url.pathname.endsWith('/session')) return route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { role: operations ? 'viewer' : 'administrator' } : { error: 'Signed out' } });
    if (url.pathname.includes('/support/tickets')) return route.fulfill({ json: { tickets: [] } });
    // Reporting is intentionally unavailable: these tests do not simulate business figures.
    return route.fulfill({ status: 503, json: { error: 'Navigation test: business API not connected.' } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const home = operations ? '/operations' : '/';
  await page.goto(origin + home);
  await page.locator('#workspace').waitFor({ state: 'visible' });
  return { context, page, requests, errors };
}
async function layout(page) {
  return page.evaluate(() => {
    const measure = selector => {
      const e = document.querySelector(selector), r = e.getBoundingClientRect(), s = getComputedStyle(e);
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height,
        order: s.order, display: s.display, direction: s.flexDirection, wrap: s.flexWrap, justify: s.justifyContent,
        overflowY: s.overflowY, position: s.position, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth };
    };
    return { sidebar: measure('#workspace-sidebar'), brand: measure('.sidebar-brand'), identity: measure('.sidebar-identity'),
      nav: measure('.primary-nav'), foot: measure('.sidebar-foot'), home: measure('[data-nav="home"]'),
      main: measure('#workspace>main'), header: measure('.workspace-header'),
      dom: [...document.querySelector('#workspace-sidebar').children].map(e => e.className),
      links: [...document.querySelectorAll('.primary-nav .nav')].map(e => ({
        left: e.querySelector('svg').getBoundingClientRect().left, labelLeft: e.querySelector('span').getBoundingClientRect().left,
        height: e.getBoundingClientRect().height, clipped: e.querySelector('span').scrollWidth > e.querySelector('span').clientWidth,
        justify: getComputedStyle(e).justifyContent,
      })) };
  });
}
function assertColumn(m, height) {
  assert.deepEqual(m.dom, ['sidebar-brand', 'sidebar-identity', 'primary-nav', 'sidebar-foot']);
  assert.equal(m.sidebar.position, 'fixed');
  for (const box of [m.sidebar, m.nav]) {
    assert.equal(box.display, 'flex'); assert.equal(box.direction, 'column'); assert.equal(box.wrap, 'nowrap');
    assert.equal(box.justify, 'flex-start');
  }
  assert.equal(m.nav.overflowY, 'auto');
  for (const box of [m.brand, m.identity, m.nav, m.foot]) assert.equal(box.order, '0');
  assert(m.brand.bottom <= m.identity.top);
  assert(m.identity.bottom <= m.nav.top);
  assert(m.nav.top - m.identity.bottom <= 18, 'navigation immediately follows portal identity');
  assert(m.home.top < 150, `Home too low: ${m.home.top}`);
  assert(m.nav.bottom <= m.foot.top);
  assert(m.foot.bottom <= height && height - m.foot.bottom <= 20, 'footer at bottom of viewport');
  assert(m.sidebar.scrollWidth <= m.sidebar.clientWidth, 'no horizontal drawer overflow');
  assert.equal(m.links.length, 8);
  for (const link of m.links) {
    assert.equal(link.justify, 'flex-start'); assert(link.height >= 44); assert(!link.clipped);
    assert.equal(link.left, m.links[0].left); assert.equal(link.labelLeft, m.links[0].labelLeft);
  }
}

for (const operations of [false, true]) {
  const portal = operations ? 'operations' : 'admin';
  for (const [width, height] of [[320,480], [320,640], [360,800], [390,844], [430,932], [768,1024], [1024,768]]) {
    test(`${portal}: rendered drawer ${width}×${height}`, async t => {
      const { context, page, errors } = await openPortal(operations, { width, height });
      t.after(() => context.close());
      assert.equal(await page.locator('#workspace-sidebar').evaluate(e => e.inert), true);
      await page.locator('#menu-toggle').click();
      const m = await layout(page); assertColumn(m, height);
      assert.equal(m.main.left, 0);
      assert(m.header.scrollWidth <= m.header.clientWidth, 'no horizontal header overflow');
      assert.equal(await page.locator('#workspace-sidebar').evaluate(e => getComputedStyle(e).transitionDuration), '0s');
      if (height === 480) assert(await page.locator('.primary-nav').evaluate(e => e.scrollHeight > e.clientHeight), 'short viewport exercises independent scrolling');
      assert(Math.abs(m.sidebar.width - Math.min(width * .84, 336)) < 1);
      assert.equal(await page.locator('#workspace>main').evaluate(e => e.inert), true);
      assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-modal'), 'true');
      assert.equal(await page.locator('.nav.active').getAttribute('data-nav'), 'home');
      assert.equal(await page.locator('#breadcrumb').textContent(), 'Home');
      await page.screenshot({ path: join(artifacts, `${portal}-${width}x${height}.png`) });
      // All links reachable by independently scrolling nav; fixed regions do not move.
      for (const link of await page.locator('.primary-nav .nav').all()) {
        await link.scrollIntoViewIfNeeded();
        const r = await link.boundingBox(), nav = await page.locator('.primary-nav').boundingBox();
        assert(r.y >= nav.y - 1 && r.y + r.height <= nav.y + nav.height + 1);
      }
      const scrolled = await layout(page);
      assert.equal(scrolled.brand.top, m.brand.top); assert.equal(scrolled.foot.top, m.foot.top);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('#menu-toggle').evaluate(e => e === document.activeElement), true);
      await page.locator('#menu-toggle').click(); await page.locator('#drawer-close').click();
      await page.locator('#menu-toggle').click(); await page.mouse.click(width - 10, height / 2);
      assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('#workspace>main').evaluate(e => e.inert), false);
      assert.deepEqual(errors, []);
    });
  }
  test(`${portal}: focus, route navigation, history and real logout handler`, async t => {
    const { context, page, requests, errors } = await openPortal(operations, { width: 390, height: 844 }, 'no-preference');
    t.after(() => context.close());
    await page.locator('#menu-toggle').click();
    await page.locator('#logout').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.locator('.sidebar-brand .wordmark').evaluate(e => e === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('#logout').evaluate(e => e === document.activeElement), true);
    // Existing link destinations and route controllers, not a duplicate test navigation.
    const links = await page.locator('.primary-nav .nav').evaluateAll(es => es.map(e => ({ key: e.dataset.nav, href: e.getAttribute('href') })));
    for (const { key, href } of links) {
      if (await page.locator('#menu-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#menu-toggle').click();
      await Promise.all([page.waitForURL(origin + href), page.locator(`[data-nav="${key}"]`).click()]);
      await page.locator('#workspace').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.nav.active').getAttribute('data-nav'), key);
      assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
      assert((await page.locator('#breadcrumb').textContent()).trim());
    }
    await page.goBack(); assert.equal(await page.locator('.nav.active').getAttribute('data-nav'), 'distribution');
    await page.goForward(); assert.equal(await page.locator('.nav.active').getAttribute('data-nav'), 'support');
    await page.goto(origin + (operations ? '/operations' : '') + '/farmers/category/larger-sagana');
    await page.locator('#workspace').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.nav.active').getAttribute('data-nav'), 'farmers');
    await page.locator('#menu-toggle').click(); await page.locator('#logout').click();
    await page.locator('#login').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.body.classList.contains('navigation-drawer-open')), false, 'logout releases drawer scroll lock');
    assert(requests.some(r => r.path === (operations ? '/api/operations/logout' : '/api/logout') && r.method === 'POST'));
    assert.deepEqual(errors, []);
  });
  test(`${portal}: desktop collapse, persistence and responsive transition`, async t => {
    const { context, page, errors } = await openPortal(operations, { width: 1440, height: 900 });
    t.after(() => context.close());
    assertColumn(await layout(page), 900);
    assert.equal((await layout(page)).main.left, 248);
    await page.screenshot({ path: join(artifacts, `${portal}-desktop-expanded.png`) });
    await page.locator('#sidebar-collapse').click();
    assert.equal((await layout(page)).sidebar.width, 72);
    assert.equal((await layout(page)).main.left, 72);
    assert.equal(await page.locator('[data-nav="home"]').getAttribute('title'), 'Home');
    await page.screenshot({ path: join(artifacts, `${portal}-desktop-collapsed.png`) });
    await page.reload(); await page.locator('#workspace').waitFor({ state: 'visible' });
    assert.equal((await layout(page)).sidebar.width, 72);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#menu-toggle').click(); assertColumn(await layout(page), 844);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => !document.querySelector('#workspace').classList.contains('nav-open'));
    assert.equal(await page.locator('#workspace>main').evaluate(e => e.inert), false);
    await page.locator('#sidebar-collapse').click(); assertColumn(await layout(page), 900);
    assert.deepEqual(errors, []);
  });
}

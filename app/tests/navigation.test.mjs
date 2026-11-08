import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const operationsHtml = await readFile(new URL('../public/operations.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/style.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../public/navigation.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const collections = await readFile(new URL('../collections.mjs', import.meta.url), 'utf8');
const expected = ['home', 'collections', 'daily-reports', 'farmers', 'customers', 'distributors', 'milk', 'processing', 'distribution', 'support'];

function navLinks(html) {
  return [...html.matchAll(/<a class="nav" data-nav="([^"]+)" href="([^"]+)"/g)]
    .map(([, key, href]) => ({ key, href }));
}

test('admin and operations shells place Collections below Home and retain existing destinations', () => {
  assert.deepEqual(navLinks(adminHtml).map(link => link.key), expected);
  assert.deepEqual(navLinks(operationsHtml).map(link => link.key), expected);
  assert.deepEqual(navLinks(adminHtml).map(link => link.href), [
    '/', '/collections', '/daily-reports', '/farmers', '/customers', '/distributors', '/milk-collection',
    '/milk-processing', '/milk-distribution', '/contact-support',
  ]);
  assert.deepEqual(navLinks(operationsHtml).map(link => link.href), [
    '/operations', '/operations/collections', '/operations/daily-reports', '/operations/farmers', '/operations/customers', '/operations/distributors',
    '/operations/milk-collection', '/operations/milk-processing',
    '/operations/milk-distribution', '/operations/contact-support',
  ]);
});

test('both shells expose grouped navigation, current page breadcrumb, and labeled menu controls', () => {
  for (const html of [adminHtml, operationsHtml]) {
    assert.match(html, /<nav class="primary-nav" aria-label="Primary navigation">/);
    for (const group of ['Overview', 'Directories', 'Milk Operations', 'Assistance']) {
      assert.match(html, new RegExp(`class="nav-label">${group}</span>`));
    }
    assert.match(html, /id="menu-toggle"[^>]*aria-label="Open menu"[^>]*aria-expanded="false"[^>]*aria-controls="workspace-sidebar"/);
    assert.match(html, /id="breadcrumb"/);
    assert.match(html, /id="logout"/);
    assert.match(html, /src="\/navigation\.js"/);
    assert.match(html, /class="sidebar-brand"[\s\S]*?class="drawer-close"/);
    assert.match(html, /class="sidebar-identity"><span class="workspace-role">(?:Admin Panel|Head of Operations)<\/span>/);
    assert.match(html, /class="sidebar-foot"><button id="logout"/);
    const sidebar = html.match(/<aside id="workspace-sidebar"[\s\S]*?<\/aside>/)?.[0] || '';
    assert.doesNotMatch(sidebar, /KRA verification access|Administration workspace|Morning Dew Operations<\/small>/);
  }
});

test('responsive navigation includes mobile drawer, desktop collapse, reduced motion, and keyboard handling', () => {
  assert.match(css, /@media\(max-width:1100px\)/);
  assert.match(css, /#workspace\.nav-open>aside#workspace-sidebar/);
  assert.match(css, /#workspace\.sidebar-collapsed/);
  assert.match(css, /width:min\(84vw,336px\)/);
  assert.match(css, /overflow-y:auto;overscroll-behavior:contain/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(js, /event\.key === 'Escape'/);
  assert.match(js, /event\.key === 'Tab'/);
  assert.match(js, /aria-modal/);
  assert.match(js, /localStorage/);
  assert.match(js, /main\.inert = true/);
});

test('server serves the shared navigation controller as a public static asset', () => {
  assert.match(server, /'\/navigation\.js':\['navigation\.js','text\/javascript'\]/);
});

test('Finance Collections shell removes Daily Reports from the retained Overview group',()=>{
  assert.match(collections,/data-nav=\"daily-reports\"/);
  assert.match(collections,/role==='finance'\)workspace=workspace\.replace\(\/<a class=\"nav\" data-nav=\"daily-reports\"/);
});

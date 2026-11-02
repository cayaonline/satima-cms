import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const operationsHtml = await readFile(new URL('../public/operations.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/style.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../public/navigation.js', import.meta.url), 'utf8');
const expected = ['home', 'farmers', 'customers', 'distributors', 'milk', 'processing', 'distribution', 'support'];

function navLinks(html) {
  return [...html.matchAll(/<a class="nav" data-nav="([^"]+)" href="([^"]+)"/g)]
    .map(([, key, href]) => ({ key, href }));
}

test('admin and operations shells retain their existing eight navigation destinations', () => {
  assert.deepEqual(navLinks(adminHtml).map(link => link.key), expected);
  assert.deepEqual(navLinks(operationsHtml).map(link => link.key), expected);
  assert.deepEqual(navLinks(adminHtml).map(link => link.href), [
    '/', '/farmers', '/customers', '/distributors', '/milk-collection',
    '/milk-processing', '/milk-distribution', '/contact-support',
  ]);
  assert.deepEqual(navLinks(operationsHtml).map(link => link.href), [
    '/operations', '/operations/farmers', '/operations/customers', '/operations/distributors',
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
  }
});

test('responsive navigation includes mobile drawer, desktop collapse, reduced motion, and keyboard handling', () => {
  assert.match(css, /@media\(max-width:1100px\)/);
  assert.match(css, /#workspace\.nav-open>aside#workspace-sidebar/);
  assert.match(css, /#workspace\.sidebar-collapsed/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(js, /event\.key === 'Escape'/);
  assert.match(js, /event\.key === 'Tab'/);
  assert.match(js, /aria-modal/);
  assert.match(js, /localStorage/);
  assert.match(js, /main\.inert = true/);
});

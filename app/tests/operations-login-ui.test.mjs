import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const operations=readFileSync(new URL('../public/operations.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/operations.html',import.meta.url),'utf8');

test('operations startup updates an element present in its shell before revealing login',()=>{
 assert.match(html,/class="workspace-role"/);
 assert.match(operations,/document\.querySelector\('\.workspace-role'\)\.textContent/);
 assert.doesNotMatch(operations,/#operations-sidebar-label/);
 assert.match(operations,/function showLogin\(\)[\s\S]*?\$\('#login'\)\.hidden=false/);
});

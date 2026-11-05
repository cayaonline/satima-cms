import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const operations=readFileSync(new URL('../public/operations.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/operations.html',import.meta.url),'utf8');

test('operations shell keeps a compact portal label and startup does not query a missing sidebar element',()=>{
 assert.match(html,/class="workspace-role"/);
 assert.match(html,/class="workspace-role">Head of Operations<\/span>/);
 assert.doesNotMatch(operations,/#operations-sidebar-label|workspace-role/);
 assert.match(operations,/function showLogin\(\)[\s\S]*?\$\('#login'\)\.hidden=false/);
});

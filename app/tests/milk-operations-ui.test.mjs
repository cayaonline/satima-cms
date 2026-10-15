import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const browser={};runInNewContext(readFileSync(new URL('../public/milk-operations.js',import.meta.url),'utf8'),{window:browser});
const {route}=browser.milkOperations;
test('processing and distribution have dedicated same-tab pages in both portals',()=>{
 for(const base of ['', '/operations']){
  assert.equal(route(base+'/milk-processing',base).module,'processing');
  assert.equal(route(base+'/milk-processing/category/satima',base).category,'Satima Farmers');
  assert.equal(route(base+'/milk-processing/awaiting-categorisation',base).category,'unassigned');
  assert.equal(route(base+'/milk-processing/new',base).type,'new-batch');
  for(const metric of ['received','accepted','rejected','processed','pending'])assert.equal(route(base+'/milk-processing/kpi/'+metric,base).metric,metric);
  assert.equal(route(base+'/milk-distribution',base).module,'distribution');
  assert.equal(route(base+'/milk-distribution/new',base).type,'new-distribution');
  for(const metric of ['finished','distributed','bottles','records','remaining'])assert.equal(route(base+'/milk-distribution/kpi/'+metric,base).metric,metric);
  assert.equal(route(base+'/milk-distribution/record/12345678-1234-1234-1234-123456789abc',base).type,'record');
  assert.equal(route(base+'/milk-processing/category/unknown',base),null);
 }
 for(const file of ['index.html','operations.html']){
  const html=readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
  const names=[...html.matchAll(/data-nav="([^"]+)"/g)].map(item=>item[1]);
  assert.deepEqual(names,['farmers','customers','distributors','milk','processing','distribution']);
  assert.match(html,/id="milk-operations-content"/);
 }
});

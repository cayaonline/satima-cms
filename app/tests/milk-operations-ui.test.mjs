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
  for(const metric of ['finished','distributed','records','remaining'])assert.equal(route(base+'/milk-distribution/kpi/'+metric,base).metric,metric);
  assert.equal(route(base+'/milk-distribution/record/12345678-1234-1234-1234-123456789abc',base).type,'record');
  assert.equal(route(base+'/milk-processing/category/unknown',base),null);
 }
 for(const file of ['index.html','operations.html']){
  const html=readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
  const names=[...html.matchAll(/data-nav="([^"]+)"/g)].map(item=>item[1]);
  assert.deepEqual(names,['home','farmers','customers','distributors','milk','processing','distribution','support']);
  assert.match(html,/id="milk-operations-content"/);
 }
});
test('active operation forms and dashboard do not request bottle counts',()=>{
 const operations=readFileSync(new URL('../public/milk-operations.js',import.meta.url),'utf8');
 const home=readFileSync(new URL('../public/home-support.js',import.meta.url),'utf8');
 for(const source of [operations,home])assert.doesNotMatch(source,/bottle|bottled/i);
 assert.match(operations,/name="quantity_liters"/);
 assert.match(home,/At a Glance|Milk Supply Chain|Distribution Destinations|Operational Attention/);
});

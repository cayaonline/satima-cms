import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const browser={};
runInNewContext(readFileSync(new URL('../public/milk.js',import.meta.url),'utf8'),{window:browser});
const {route,categoryCards,categoryPie}=browser.milkUI;

test('milk category cards open dedicated same-tab pages for both portals',()=>{
 const items=[{category:'Satima Farmers',deliveries:3,liters:'12.5'},{category:'Awaiting Categorisation',deliveries:1,liters:'8'}];
 for(const base of ['/milk-collection','/operations/milk-collection']){
  const html=categoryCards(items,base);
  assert.equal((html.match(/class="supplier-category"/g)||[]).length,5);
  assert.match(html,new RegExp(`href="${base}/category/satima"`));
  assert.match(html,new RegExp(`href="${base}/awaiting-categorisation"`));
  assert.doesNotMatch(html,/target="_blank"/);
  assert.equal(route(`${base}/category/satima`,base).filter,'Satima Farmers');
  assert.equal(route(`${base}/awaiting-categorisation`,base).filter,'unassigned');
  assert.equal(route(base,base).filtered,false);
  for(const metric of ['today','week','month','farmers-today'])assert.equal(route(`${base}/kpi/${metric}`,base).kpi,metric);
  assert.equal(route(`${base}/category/unknown`,base),null);
 }
 assert.equal((categoryCards(items.filter(item=>item.category!=='Awaiting Categorisation'),'/milk-collection').match(/class="supplier-category"/g)||[]).length,4);
});

test('milk pie percentages use only the four named supplier categories',()=>{
 const html=categoryPie([{category:'Satima Farmers',liters:'2'},{category:'Others',liters:'2'},{category:'Awaiting Categorisation',liters:'96'}]);
 assert.match(html,/50\.0%/);
 assert.match(html,/4 L across the four categories/);
 assert.doesNotMatch(html,/Awaiting Categorisation/);
 assert.doesNotMatch(html,/milk-donut/);
 assert.equal((html.match(/class="milk-dot"/g)||[]).length,4);
});

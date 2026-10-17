import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,normalizedWeeks,monthlyView,detectIssues,units,decimal} from '../milk-performance.mjs';
import {sameWeek,planImport} from '../scripts/import-milk-performance.mjs';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('CSV and workbook mappings preserve blank cells and source expressions',()=>{
 const [raw]=parseCsv('\uFEFFreport_year,report_month,week_number,source_worksheet,source_row,source_week_label,farmers_milk_supply_liters,available_for_pasteurization_liters,pstd_inc_cf_source_expression,milk_out_stores_liters,milk_out_homes_liters,total_milk_out_liters,returns_liters,return_rate_source_fraction,inhouse_liters\n2026,October,1,Sheet1,2,WEEK 1,5,5,"3+2=5",2,2,4,1,0.25,\n');
 const workbook={2:{A:{value:'WEEK 1'},B:{value:'5'},C:{value:'5',formula:'B2'},D:{value:'3+2=5'},E:{value:'2'},F:{value:'2'},H:{value:'4'},I:{value:'1'},J:{value:'0.25'},M:{value:' '}}};
 const [week]=normalizedWeeks([raw],workbook);
 assert.equal(week.values.inhouse_liters,null);
 assert.equal(week.original_expression,'3+2=5');
 assert.equal(week.issues.length,0);
 assert.throws(()=>normalizedWeeks([{...raw,milk_out_stores_liters:'3'}],workbook),/differs from workbook/);
});

test('four- and five-week monthly totals distinguish flows, rates, latest inventory and missing data',()=>{
 const make=(n)=>({week_number:n,farmers_milk_supply_liters:'5',available_for_pasteurization_liters:'5',total_milk_out_liters:'4',returns_liters:'1',inhouse_liters:String(n),carry_forward_pasteurized_liters:n===1?null:String(n)});
 const four=monthlyView([1,2,3,4].map(make)),five=monthlyView([1,2,3,4,5].map(make));
 assert.equal(four.farmers_milk_supply_liters.value,'20');assert.equal(five.farmers_milk_supply_liters.value,'25');
 assert.equal(five.return_rate_source_fraction.value,'0.25');assert.equal(five.inhouse_liters.value,'5');
 assert.equal(four.carry_forward_pasteurized_liters.value,'4');
 assert.equal(monthlyView([make(1),{...make(2),returns_liters:null}]).returns_liters.value,null);
 assert.equal(monthlyView([make(1),make(3)]).farmers_milk_supply_liters.value,null);
});

test('validation separates raw milk, net sales, reported expressions and material return-rate errors',()=>{
 const base={milk_out_stores_liters:'2',milk_out_homes_liters:'2',milk_out_raw_liters:'1',total_milk_out_liters:'4',returns_liters:'1',total_sales_source_liters:'3',return_rate_source_fraction:'0.25',pstd_inc_cf_reported_total_liters:'5',original_expression:'3+2=5'};
 assert.deepEqual(detectIssues(base),[]);
 const issues=detectIssues({...base,total_sales_source_liters:'3.5',return_rate_source_fraction:'0.26',pstd_inc_cf_reported_total_liters:'6'});
 assert.deepEqual(issues.map(i=>i.metric),['total_sales_source_liters','return_rate_source_fraction','pstd_inc_cf_reported_total_liters']);
 assert.equal(decimal(units('0.014541929229277752')),'0.014541929229277752');
});

test('repeat imports skip identical weeks and corrected values require a revision',()=>{
 const week={year:2026,month:10,week:1,row:2,source_week_label:'WEEK 1',original_expression:'3+2=5',values:{farmers_milk_supply_liters:'5'}};
 const old={report_year:2026,report_month:10,week_number:1,source_row:2,source_week_label:'WEEK 1',original_pasteurization_expression:'3+2=5',farmers_milk_supply_liters:'5.000000'};
 assert.equal(sameWeek(old,week),true);
 assert.equal(planImport([week],[old])[0].action,'skip');
 assert.equal(planImport([{...week,values:{farmers_milk_supply_liters:'6'}}],[old])[0].action,'revise');
});

test('historical overview follows the supply chain in both responsive portal shells',()=>{
 const home=readFileSync(new URL('../public/home-support.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 assert.ok(home.indexOf('Milk Supply Chain')<home.indexOf('id="milk-performance"'));
 assert.ok(home.indexOf('id="milk-performance"')<home.indexOf('Milk Volume Overview'));
 for(const shell of ['index.html','operations.html'])assert.match(readFileSync(new URL('../public/'+shell,import.meta.url),'utf8'),/milk-performance\.js/);
 assert.match(css,/\.performance-table-wrap\{[^}]*overflow-x:auto/);
 assert.match(css,/@media\(max-width:600px\)\{\.performance-heading/);
});

test('historical sections use the shared monthly API without mixing operational metrics',async()=>{
 const source=readFileSync(new URL('../public/milk-performance.js',import.meta.url),'utf8');
 const saved=new Map(),storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
 const browser={};const context={window:browser,sessionStorage:storage,location:{pathname:'/operations'},console};
 runInNewContext(source,context);
 const {metrics}=await import('../milk-performance.mjs');
 const weekly=[1,2,3,4,5].map(week_number=>({week_number,
  farmers_milk_supply_liters:'5',available_for_pasteurization_liters:'4',
  pstd_inc_cf_reported_total_liters:'3',milk_out_stores_liters:'2',
  milk_out_homes_liters:'1',milk_out_raw_liters:'0.5',total_milk_out_liters:'3',
  total_sales_source_liters:'2.5',returns_liters:'0.5',
  return_rate_source_fraction:'0.166666',rescued_liters:'0.2',
  inhouse_liters:String(week_number),rnd_liters:null,
  carry_forward_pasteurized_liters:String(week_number),
  carry_forward_raw_liters:week_number===5?null:String(week_number)}));
 const makeData=month=>({months:[{year:2026,month:9,label:'September 2026'},{year:2026,month:8,label:'August 2026'}],
  selected:{year:2026,month,label:month===8?'August 2026':'September 2026'},
  records:weekly,totals:monthlyView(weekly),metrics,issue_count:0});
 const calls=[],api=async path=>{calls.push(path);return makeData(path.includes('2026-08')?8:9);};
 function host(){const nodes=new Map();return {isConnected:true,innerHTML:'',querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',value:'',disabled:false,onchange:null});return nodes.get(selector);}};}
 for(const [scope,present,absent] of [
  ['collection',['Farmers Milk Supply','25 L','Week 5'],['Pstd + Inc','Milk Out — Stores','Returns & Inventory']],
  ['processing',['Milk Available for Pasteurization','Pstd + Inc + CF','20 L'],['Farmers Milk Supply','Milk Out — Stores']],
  ['distribution',['Milk Out — Stores','Milk Out — Homes','Raw Milk Out','Total Milk Out','Source-Reported Total Sales'],['Farmers Milk Supply','Pstd + Inc']]
 ]){
  const node=host(),returns=scope==='distribution'?{innerHTML:''}:null;
  browser.milkPerformance.mountModule(node,api,scope,false,returns);
  await new Promise(resolve=>setImmediate(resolve));
  const html=node.querySelector('.performance-results').innerHTML;
  for(const label of present)assert.match(html,new RegExp(label.replace(/[+]/g,'\\+')));
  for(const label of absent)assert.doesNotMatch(html,new RegExp(label.replace(/[+]/g,'\\+')));
  assert.match(html,/without verified calendar dates/);
  if(returns){
   assert.match(returns.innerHTML,/Returns & Inventory/);
   assert.match(returns.innerHTML,/16\.67%/);
   assert.match(returns.innerHTML,/Latest weekly reading/);
   assert.match(returns.innerHTML,/Not reported/);
   assert.doesNotMatch(returns.innerHTML,/25 L/);
  }
  node.querySelector('.performance-month').value='2026-08';
  await node.querySelector('.performance-month').onchange();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(storage.getItem('satima-performance-month'),'2026-08');
  assert.equal(node.querySelector('.performance-month').value,'2026-08');
 }
 assert.ok(calls.every(path=>path.startsWith('/milk-performance')));
 const home=host();browser.milkPerformance.mountHome(home,api,false);await new Promise(resolve=>setImmediate(resolve));
 const summary=home.querySelector('.performance-results').innerHTML;
 assert.match(summary,/\/operations\/milk-collection/);
 assert.match(summary,/\/operations\/milk-processing/);
 assert.match(summary,/\/operations\/milk-distribution/);
 assert.doesNotMatch(summary,/<table/);
});

test('historical sections remain on overview routes and returns precede distribution trends',()=>{
 const collection=readFileSync(new URL('../public/milk.js',import.meta.url),'utf8');
 const operations=readFileSync(new URL('../public/milk-operations.js',import.meta.url),'utf8');
 assert.ok(collection.indexOf('id="milk-reporting"')<collection.indexOf('id="milk-historical"'));
 assert.ok(collection.indexOf('id="milk-historical"')<collection.indexOf('id="milk-stats"'));
 assert.ok(operations.indexOf('id="operation-historical"')<operations.indexOf('id="operation-stats"'));
 assert.ok(operations.indexOf('id="operation-returns"')<operations.indexOf('id="operation-trends"'));
 assert.match(operations,/isProcessing\?'processing':'distribution'/);
});

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

test('homepage sections and KPI groups consume business actuals in both responsive portal shells',()=>{
 const home=readFileSync(new URL('../public/home-support.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 const sections=['milk-supply-chain-title','at-a-glance-title','operational-figures-title','milk-volume-overview-title','distribution-destinations-title','operational-attention-title'];
 assert.deepEqual([...sections].sort((a,b)=>home.indexOf(`aria-labelledby="${a}"`)-home.indexOf(`aria-labelledby="${b}"`)),sections);
 assert.match(home,/overview-directory-kpis/);assert.match(home,/overview-operational-kpis/);
 assert.match(home,/businessCard\('Milk Collected','farmers_milk_supply_liters'/);
 assert.match(home,/businessCard\('Milk Available for Pasteurization','available_for_pasteurization_liters'/);
 assert.match(home,/businessCard\('Pasteurized Including Carry Forward','pstd_inc_cf_reported_total_liters'/);
 assert.match(home,/businessCard\('Total Milk Out','total_milk_out_liters'/);
 assert.doesNotMatch(home,/card\('Milk Accepted'/);assert.doesNotMatch(home,/card\('Milk Rejected'/);
 assert.match(home,/overview-chart-bar-collected/);assert.match(home,/overview-chart-bar-second/);
 assert.match(home,/milk_out_stores_liters/);assert.match(home,/milk_out_homes_liters/);
 assert.doesNotMatch(home,/overview-split/);
 for(const shell of ['index.html','operations.html'])assert.match(readFileSync(new URL('../public/'+shell,import.meta.url),'utf8'),/milk-performance\.js/);
 assert.match(css,/\.performance-table-wrap\{[^}]*overflow-x:auto/);
 assert.match(css,/\.overview-volume-chart\{display:block;width:100%;height:auto/);
 assert.match(css,/\.overview-directory-kpis,.overview-operational-kpis\{grid-template-columns:repeat\(4/);
 assert.match(css,/@media\(max-width:600px\)\{\.performance-heading/);
});

test('overview keeps directory counts independent and renders four source-mapped operational KPIs',async()=>{
 const source=readFileSync(new URL('../public/home-support.js',import.meta.url),'utf8'),nodes=new Map(),saved=new Map(),calls=[];
 const element=()=>({innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,addEventListener(_type,fn){this.listener=fn;}});
 const root={innerHTML:'',querySelector(selector){if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);},querySelectorAll(selector){if(selector==='.overview-custom')return ['from','to','apply'].map((_,i)=>{const key=`custom-${i}`;if(!nodes.has(key))nodes.set(key,element());return nodes.get(key);});return [];}};
 const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
 const browser={satimaDates:{format:value=>String(value).split('-').reverse().join('/'),today:()=>"2026-09-30",refresh(){}},milkPerformance:{businessValue:(business,key)=>business.source==='historical'?business.report.totals[key]?.value??null:null,businessShown:(business,key)=>{const value=business.report.totals[key]?.value;return value===null||value===undefined?'Not reported':`${value} L`;}}};
 const report={months:[{year:2026,month:9,label:'September 2026',weeks:2}],selected:{year:2026,month:9,label:'September 2026'},records:[{week_number:1,farmers_milk_supply_liters:'10',available_for_pasteurization_liters:'8'},{week_number:2,farmers_milk_supply_liters:'12',available_for_pasteurization_liters:null}],totals:{farmers_milk_supply_liters:{value:'22'},available_for_pasteurization_liters:{value:'8'},pstd_inc_cf_reported_total_liters:{value:null},total_milk_out_liters:{value:'20'},milk_out_stores_liters:{value:'13'},milk_out_homes_liters:{value:'7'},returns_liters:{value:'1'}}};
 const historical={source:'historical',month:'2026-09',report};
 const makeData=business=>({range:{period:business.source==='historical'?'custom':'week',from:business.source==='historical'?'2026-09-01':'2026-10-26',to:business.source==='historical'?'2026-09-30':'2026-11-01'},network:{farmers:89,customers:40,distributors:4,stores:36},operations:{collection_records:0,collected_liters:'0',quality_records:0,accepted_liters:'0',rejected_liters:'0',batch_records:0,processed_liters:'0',dispatched_liters:'0',dispatch_records:0,customer_liters:'0',store_liters:'0',pending_quality:0,rejected_checks:0,accepted_unallocated_liters:'0',draft_distributions:0},trend:[],business,note:'Stages have separate sources.'});
 const api=async path=>{calls.push(path);if(path.startsWith('/milk-performance'))return report;return makeData(path.includes('period=week')?{source:'operations',reason:'Historical weekly data has no verified dates.'}:historical);};
 const context={window:browser,document:{querySelector:()=>root},sessionStorage:storage,URLSearchParams,setInterval(){},console};runInNewContext(source,context);
 browser.homeSupport.mount(api,false,'home');await new Promise(resolve=>setImmediate(resolve));
 let html=root.querySelector('#overview-data').innerHTML;
 const directoryStart=html.indexOf('id="at-a-glance-title"'),directoryEnd=html.indexOf('</section>',directoryStart),directory=html.slice(directoryStart,directoryEnd);
 const figuresStart=html.indexOf('id="operational-figures-title"'),figuresEnd=html.indexOf('</section>',figuresStart),figures=html.slice(figuresStart,figuresEnd);
 assert.equal((directory.match(/class="overview-card"/g)||[]).length,4);
 assert.deepEqual(['Farmers','Customers','Distributors','Stores'].map(label=>directory.indexOf(`<span>${label}</span>`)>-1),[true,true,true,true]);
 assert.equal((figures.match(/class="overview-card"/g)||[]).length,4);
 for(const label of ['Milk Collected','Milk Available for Pasteurization','Pasteurized Including Carry Forward','Total Milk Out'])assert.ok(figures.includes(`<span>${label}</span>`));
 assert.match(figures,/Not reported/);assert.match(figures,/Reporting Period Selector/);
 assert.ok(html.indexOf('id="milk-supply-chain-title"')<html.indexOf('id="at-a-glance-title"'));
 assert.ok(html.indexOf('id="operational-attention-title"')>html.indexOf('id="distribution-destinations-title"'));
 assert.match(html,/Week 2[\s\S]*?Not reported/);assert.doesNotMatch(html,/Milk Accepted<\/span>/);assert.doesNotMatch(html,/Milk Rejected<\/span>/);
 const period=nodes.get('#overview-period');period.value='week';period.onchange();await new Promise(resolve=>setImmediate(resolve));html=root.querySelector('#overview-data').innerHTML;
 const afterStart=html.indexOf('id="at-a-glance-title"'),afterEnd=html.indexOf('</section>',afterStart),after=html.slice(afterStart,afterEnd);
 assert.equal((after.match(/class="overview-card"/g)||[]).length,4);
 for(const [label,count] of [['Farmers',89],['Customers',40],['Distributors',4],['Stores',36]])assert.ok(after.includes(`<span>${label}</span><strong>${count}</strong>`));
 assert.ok(calls.some(path=>path.includes('period=week')));
 browser.homeSupport.mount(api,true,'home');await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.querySelector('#overview-data').innerHTML,/href="\/operations\/farmers"/);
 assert.match(root.querySelector('#overview-data').innerHTML,/href="\/operations\/distributors\/type\/store"/);
});

test('homepage renders independent chronological historical charts for every available month',async()=>{
 const source=readFileSync(new URL('../public/home-support.js',import.meta.url),'utf8'),nodes=new Map();
 const element=()=>({innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,addEventListener(_type,fn){this.listener=fn;}});
 const root={innerHTML:'',querySelector(selector){if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);},querySelectorAll(){return [];}};
 const months=[5,6,7,8,9].map(month=>({year:2026,month,label:['','January','February','March','April','May','June','July','August','September'][month]+' 2026',weeks:month===7||month===9?5:4}));
 const makeReport=month=>{const item=months.find(x=>x.month===month),records=Array.from({length:item.weeks},(_,i)=>({week_number:i+1,farmers_milk_supply_liters:String(month*100+i+1),available_for_pasteurization_liters:String(month*80+i+1)}));const sum=key=>records.reduce((total,week)=>total+Number(week[key]),0);return {months:[...months].reverse(),selected:{year:2026,month,label:item.label,weeks:item.weeks},records,totals:{farmers_milk_supply_liters:{value:String(sum('farmers_milk_supply_liters'))},available_for_pasteurization_liters:{value:String(sum('available_for_pasteurization_liters'))},milk_out_stores_liters:{value:String(month*30)},milk_out_homes_liters:{value:String(month*20)}}};};
 const reports=new Map(months.map(item=>[item.month,makeReport(item.month)]));
 const opsBusiness={source:'operations',month:null,report:null,reason:'Historical weeks are separate from the selected operational range.'};
 const home={range:{period:'month',from:'2026-11-01',to:'2026-11-02'},network:{farmers:1,customers:2,distributors:3,stores:4},operations:{collection_records:0,collected_liters:'0',quality_records:0,accepted_liters:'0',rejected_liters:'0',batch_records:0,processed_liters:'0',dispatched_liters:'0',dispatch_records:0,customer_liters:'0',store_liters:'0',pending_quality:0,rejected_checks:0,accepted_unallocated_liters:'0',draft_distributions:0},trend:[],business:opsBusiness,note:'Independent data sources.'};
 const api=async path=>{if(path.startsWith('/home'))return home;if(path==='/milk-performance')return reports.get(9);const month=Number(path.match(/2026-(\d{2})/)?.[1]);return reports.get(month);};
 const browser={satimaDates:{format:value=>String(value).split('-').reverse().join('/'),today:()=>"2026-11-02",refresh(){}},milkPerformance:{businessValue:()=>null,businessShown:()=>"Not reported"}};
 const context={window:browser,document:{querySelector:()=>root},sessionStorage:{getItem:()=>null,setItem(){}},URLSearchParams,setInterval(){},console};runInNewContext(source,context);browser.homeSupport.mount(api,false,'home');
 await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 const html=root.querySelector('#overview-data').innerHTML,volume=html.slice(html.indexOf('id="milk-volume-overview-title"'),html.indexOf('id="distribution-destinations-title"')),destinations=html.slice(html.indexOf('id="distribution-destinations-title"'),html.indexOf('id="operational-attention-title"'));
 const expected=months.map(item=>item.label);
 assert.deepEqual(expected.map(label=>volume.indexOf(`${label} — Milk Volume Overview`)).every((pos,index,positions)=>pos>=0&&(index===0||positions[index-1]<pos)),true);
 assert.deepEqual(expected.map(label=>destinations.indexOf(`${label} — Distribution Destinations`)).every((pos,index,positions)=>pos>=0&&(index===0||positions[index-1]<pos)),true);
 assert.equal((volume.match(/class="overview-volume-chart"/g)||[]).length,5);
 assert.equal((destinations.match(/class="overview-destination-bars"/g)||[]).length,5);
 assert.equal((volume.match(/class="overview-month-card"/g)||[]).length,5);
 assert.equal((destinations.match(/class="overview-month-card"/g)||[]).length,5);
 assert.match(volume,/Week 5/);
 assert.match(volume,/Milk Collected: <strong>2,010 L<\/strong>/);
 assert.match(volume,/Milk Collected: <strong>4,515 L<\/strong>/);
 assert.match(destinations,/150 L/);assert.match(destinations,/160 L/);assert.match(destinations,/Stores/);assert.match(destinations,/Customers/);
 assert.doesNotMatch(destinations,/Distributors/);
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
  records:weekly,totals:monthlyView(weekly),metrics,issue_count:0,
  previous_month:{label:'August 2026',farmers_milk_supply_liters:'20'},
  reconciliation:Object.fromEntries(['collection','processing','distribution'].map(scope=>[scope,{status:'not_comparable',reason:'Historical weeks do not have verified dates.',reported_liters:'25',recorded_liters:null,difference_liters:null,source_issue_count:0}]))});
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
  assert.match(html,/Historical \/ Recorded Reconciliation/);
  assert.match(html,/Not Comparable/);
  if(scope==='collection')assert.match(html,/Previous reported month/);
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

test('weekly breakdown follows primary operating metrics and returns precede distribution trends',()=>{
 const collection=readFileSync(new URL('../public/milk.js',import.meta.url),'utf8');
 const operations=readFileSync(new URL('../public/milk-operations.js',import.meta.url),'utf8');
 assert.ok(operations.indexOf('id="operation-returns"')<operations.indexOf('id="operation-inventory"'));
 assert.ok(operations.indexOf('id="operation-inventory"')<operations.indexOf('id="operation-trends"'));
 assert.ok(collection.indexOf('id="milk-reporting"')<collection.indexOf('id="milk-stats"'));
 assert.ok(collection.indexOf('id="milk-stats"')<collection.indexOf('id="historical-weekly"'));
 assert.ok(operations.indexOf('id="operation-stats"')<operations.indexOf('id="historical-weekly"'));
 assert.ok(operations.indexOf('id="operation-returns"')<operations.indexOf('id="operation-trends"'));
 assert.match(operations,/isProcessing\?'processing':'distribution'/);
});

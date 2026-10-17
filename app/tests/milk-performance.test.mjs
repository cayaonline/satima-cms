import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,normalizedWeeks,monthlyView,detectIssues,units,decimal} from '../milk-performance.mjs';
import {sameWeek,planImport} from '../scripts/import-milk-performance.mjs';
import {readFileSync} from 'node:fs';

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

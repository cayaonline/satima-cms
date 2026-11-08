import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dailyReportsRoutes,dailyReportsAllowed,csvForDays,dailyReportCalculations,dailyReportsInternals} from '../daily-reports.mjs';
import {aggregate,parseCsv} from '../scripts/import-daily-reports.mjs';

const fixture=new URL('./fixtures/daily-reports/',import.meta.url);
const raw={};for(const file of ['eod_reports.csv','delivery_manifests.csv','store_deliveries.csv','home_deliveries.csv','daily_summary.csv','missing_report_dates.csv'])raw[file]=await readFile(new URL(file,fixture));
function response(){return{headers:{},status:0,body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v},writeHead(status,headers={}){this.status=status;for(const [k,v]of Object.entries(headers))this.headers[k.toLowerCase()]=v},end(body=''){this.body=String(body)}}}
const url=path=>new URL(path,'http://satima.test');

test('Daily Reports permits Admin and both Operations session types only',async()=>{
 assert.equal(dailyReportsAllowed('administrator'),true);assert.equal(dailyReportsAllowed('head_of_operations'),true);assert.equal(dailyReportsAllowed('finance'),false);assert.equal(dailyReportsAllowed(null),false);
 for(const viewerRole of ['viewer','registration_viewer']){const res=response();assert.equal(await dailyReportsRoutes({method:'GET'},res,'/api/operations/daily-reports',url('/api/operations/daily-reports'),{pool:{async query(){return{rows:[]}}},role:null,viewerRole}),true);assert.equal(res.status,200);assert.match(res.headers['cache-control'],/private, no-store/)}
 const financeOps=response();await assert.rejects(dailyReportsRoutes({method:'GET'},financeOps,'/api/operations/daily-reports',url('/api/operations/daily-reports'),{pool:{},role:'finance',viewerRole:null}),e=>e.status===403);assert.match(financeOps.headers['cache-control'],/private, no-store/);
 const adminScript=response();await dailyReportsRoutes({method:'GET'},adminScript,'/api/daily-reports/daily-reports.js',url('/api/daily-reports/daily-reports.js'),{pool:{},role:'administrator'});assert.equal(adminScript.status,200);assert.match(adminScript.headers['cache-control'],/private, no-store/);
 for(const [role,status] of [['finance',403],[null,401]]){const res=response();await assert.rejects(dailyReportsRoutes({method:'GET'},res,'/api/daily-reports/daily-reports.js',url('/api/daily-reports/daily-reports.js'),{pool:{},role,viewerRole:null}),e=>e.status===status);assert.match(res.headers['cache-control'],/private, no-store/)}
 for(const [path,location]of [['/daily-reports','/'],['/operations/daily-reports','/operations']]){const res=response();await dailyReportsRoutes({method:'GET'},res,path,url(path),{pool:{},role:null,viewerRole:null});assert.equal(res.status,303);assert.equal(res.headers.location,location)}
 const res=response();await dailyReportsRoutes({method:'GET'},res,'/daily-reports',url('/daily-reports'),{pool:{},role:null,viewerRole:'viewer'});assert.equal(res.status,303);assert.equal(res.headers.location,'/operations/daily-reports');
 const page=response();await dailyReportsRoutes({method:'GET'},page,'/operations/daily-reports',url('/operations/daily-reports'),{pool:{},role:null,viewerRole:'registration_viewer'});assert.equal(page.status,200);assert.match(page.headers['content-security-policy'],/script-src 'self'/);assert.match(page.body,/<title>Satima CMS · Daily Reports<\/title>/);assert.match(page.body,/data-nav="daily-reports"/);assert.match(page.headers['cache-control'],/private, no-store/);
});

test('data and export responses are private no-store and API returns no PII',async()=>{
 const synthetic={name:'Fictional Privacy Name',address:'12 Fictional Lane',phone:'+254700000099'};
 const pool={async query(sql){if(sql.includes('daily_report_days'))return{rows:[{operational_date:'2026-07-01',report_type:'EOD',report_available:true,store_count:1,home_customer_count:1,stores_litres_calculated:'3.00',homes_litres_calculated:'1.00',overall_litres_calculated:'4.00',overall_litres_reported:'4.00',validation_status:'OK'}]};if(sql.includes('daily_report_store_lines'))return{rows:[{operational_date:'2026-07-01',store_name_std:'Fictional Ridge Outlet',qty_1l_bottles:2,qty_500ml_bottles:2,litres_calculated:3}]};return{rows:[{month:'2026-07-01',distinct_home_customers:1,home_deliveries:1,home_litres:1,customers_all_months:0,customers_one_month:1}]}}};
 const res=response();await dailyReportsRoutes({method:'GET'},res,'/api/daily-reports',url('/api/daily-reports'),{pool,role:'administrator'});assert.equal(res.status,200);assert.match(res.headers['cache-control'],/private, no-store/);const json=JSON.parse(res.body);for(const value of Object.values(synthetic))assert.equal(res.body.includes(value),false);assert.equal(json.stores[0].storeName,'Fictional Ridge Outlet');assert.equal(json.days[0].overallLitresCalculated,4);
 const csv=response();await dailyReportsRoutes({method:'GET'},csv,'/api/daily-reports/export.csv',url('/api/daily-reports/export.csv?month=2026-07'),{pool,role:'administrator'});assert.match(csv.headers['cache-control'],/private, no-store/);assert.ok(csv.body.startsWith('\ufeff'));
});

test('CSV neutralizes formulas and preserves NULL as an em dash',()=>{
 const csv=csvForDays([{date:'2026-07-01',reportType:'EOD',reportAvailable:true,storeCount:null,storesLitresCalculated:null,homeCustomerCount:null,homesLitresCalculated:null,overallLitresCalculated:null,overallLitresReported:null,returnsLitres:null,rescuedLitres:null,spoiltLitres:null,validationStatus:'OK'}]);assert.match(csv,/\ufeff/);assert.match(csv,/—/);
 assert.equal(dailyReportsInternals.csvCell(null),'"—"');assert.equal(dailyReportsInternals.csvCell('=1+1'), "\"'=1+1\"");
});

test('fictional month and weekday totals keep Manifest planned litres separate',()=>{
 const days=[{date:'2026-07-01',reportType:'EOD',reportAvailable:true,storesLitresCalculated:3,homesLitresCalculated:1,overallLitresCalculated:4},{date:'2026-07-02',reportType:'EOD',reportAvailable:true,storesLitresCalculated:2,homesLitresCalculated:2,overallLitresCalculated:4},{date:'2026-07-01',reportType:'Manifest',reportAvailable:true,overallLitresCalculated:99}];const result=dailyReportCalculations(days);assert.equal(result.monthly[0].totalLitres,8);assert.equal(result.monthly[0].days,2);assert.equal(result.weekdays[3].totalLitres,undefined);assert.equal(result.weekdays[3].storeLitres,3);assert.equal(days.filter(d=>d.reportType==='Manifest')[0].overallLitresCalculated,99);
});

test('fictional mixed-report CSV fixture filters Manifest lines and preserves source validation',()=>{
 const result=aggregate(raw);assert.equal(result.storeLines.length,2);assert.deepEqual(result.storeLines.map(x=>x.storeName).sort(),['Capital Center','Fictional Ridge Outlet']);assert.equal(result.homeRowCount,1);assert.deepEqual(result.missingDates,['2026-07-02']);const eod=result.days.find(d=>d.type==='EOD'&&d.available!==false);assert.equal(eod.status,'DISCREPANCY');assert.equal(eod.overallCalc,eod.overallReported);
});

test('home delivery PII is consumed for aggregates and discarded from importer output',()=>{
 const result=aggregate(raw),serialized=JSON.stringify(result);for(const value of ['Fictional Privacy Name','12 Fictional Lane','+254700000099','FICTIONAL-CUSTOMER-KEY','Fictional Manifest Name','34 Plan Road','+254700000098','MANIFEST-PII-KEY'])assert.equal(serialized.includes(value),false);assert.deepEqual(result.homeMonthly[0],{month:'2026-07-01',distinct:1,deliveries:1,litres:1,allMonths:0,oneMonth:1});assert.equal(result.storeLines.length,2);assert.deepEqual(result.storeLines.map(x=>x.storeName).sort(),['Capital Center','Fictional Ridge Outlet']);assert.equal(result.storeLines.find(x=>x.storeName==='Capital Center').litres,6);const eod=result.days.find(d=>d.type==='EOD'&&d.available!==false),manifest=result.days.find(d=>d.type==='Manifest'&&d.available!==false);assert.equal(eod.storesCalc,9);assert.equal(eod.homesCalc,1);assert.equal(eod.overallCalc,10);assert.equal(eod.status,'DISCREPANCY','Source validation status wins even when overall totals match');assert.equal(manifest.overallCalc,99);assert.deepEqual(result.missingDates,['2026-07-02']);assert.equal(result.missingRowCount,2);
 assert.equal(parseCsv('a,b\n"x,y","say ""hi"""')[0].b,'say "hi"');
});

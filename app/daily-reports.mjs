import {readFile} from 'node:fs/promises';

export const dailyReportsAllowed=role=>role==='administrator'||role==='head_of_operations';
const problem=(status,message)=>Object.assign(new Error(message),{status});
const months=['2026-07','2026-08','2026-09','2026-10'];
const sourceNote='Source: End-of-Day reports from the Operations WhatsApp group, 1 Jul–31 Oct 2026. Litres recalculated from each report’s lines (1× = 1 L bottle, ½× = 500 ml bottle). ‘No report found’ does not mean no deliveries.';
const csvCell=value=>{const cell=value===null||value===undefined?'—':value;return '"'+String(typeof cell==='string'&&/^[\s]*[=+@\-\t\r]/.test(cell)?"'"+cell:cell).replaceAll('"','""')+'"'};
function shell(role){
 const operations=role==='head_of_operations';
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Satima CMS · Daily Reports</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/daily-reports.css"><script src="/navigation.js" defer></script><script src="/collections-shell.js" defer></script><script src="/api/${operations?'operations/':''}daily-reports/daily-reports.js" defer></script></head><body><div id="workspace"><button class="nav-backdrop" id="nav-backdrop" type="button" aria-label="Close navigation menu" tabindex="-1"></button><aside id="workspace-sidebar" aria-label="Workspace navigation"><!--SIDEBAR--></aside><main><header class="workspace-header"><button id="menu-toggle" class="menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="workspace-sidebar">Menu</button><strong>Satima Farmhouse CMS · ${operations?'Head of Operations':'Admin'} / <span id="breadcrumb">Daily Reports</span></strong><button id="logout" class="logout">Sign out</button></header><div id="daily-reports" class="content" aria-live="polite"><p role="status">Loading Daily Reports…</p></div></main></div></body></html>`;
}
async function pageShell(role){
 const operations=role==='head_of_operations';
 const html=await readFile(new URL(operations?'./public/operations.html':'./public/index.html',import.meta.url),'utf8');
 const sidebar=html.match(/<aside id="workspace-sidebar"[\s\S]*?<\/aside>/)?.[0];
 let result=shell(role).replace('<!--SIDEBAR-->',sidebar);
 if(role==='finance')result=result.replace(/<a class="nav" data-nav="daily-reports"[\s\S]*?<\/a>/,'');
 return result;
}
const n=v=>v===null||v===undefined?null:Number(v);
const cleanDay=r=>({date:String(r.operational_date).slice(0,10),reportType:r.report_type,reportAvailable:r.report_available,
 storeCount:n(r.store_count),homeCustomerCount:n(r.home_customer_count),
 storesLitresCalculated:n(r.stores_litres_calculated),storesLitresReported:n(r.stores_litres_reported),
 homesLitresCalculated:n(r.homes_litres_calculated),homesLitresReported:n(r.homes_litres_reported),
 overallLitresCalculated:n(r.overall_litres_calculated),overallLitresReported:n(r.overall_litres_reported),
 returnsLitres:n(r.returns_litres),rescuedLitres:n(r.rescued_litres),spoiltLitres:n(r.spoilt_litres),replacementsLitres:n(r.replacements_litres),validationStatus:r.validation_status});
export function dailyReportCalculations(days){
 const months=['2026-07','2026-08','2026-09','2026-10'],eod=days.filter(d=>d.reportType==='EOD'&&d.reportAvailable);
 const sumKnown=(rows,key)=>{const xs=rows.map(r=>r[key]).filter(v=>v!==null&&v!==undefined);return xs.length?xs.reduce((a,v)=>a+Number(v),0):null};
 const monthly=months.map(month=>{const rows=eod.filter(d=>d.date.startsWith(month));return{month,days:rows.length,storeLitres:sumKnown(rows,'storesLitresCalculated'),homeLitres:sumKnown(rows,'homesLitresCalculated'),totalLitres:sumKnown(rows,'overallLitresCalculated')}});
 const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((weekday,index)=>{const rows=eod.filter(d=>new Date(d.date+'T12:00:00Z').getUTCDay()===index);return{weekday,days:rows.length,storeLitres:rows.length?sumKnown(rows,'storesLitresCalculated')/rows.length:null,homeLitres:rows.length?sumKnown(rows,'homesLitresCalculated')/rows.length:null}});
 return{monthly,weekdays};
}
export function csvForDays(days){
 const header=['Date','Stores served','Store L','Home customers','Home L','Total calculated L','Total reported L','Difference L','Returns L','Rescued L','Spoilt L','Check'];
 const rows=days.filter(x=>x.reportType==='EOD').map(d=>d.reportAvailable?[d.date,d.storeCount,d.storesLitresCalculated,d.homeCustomerCount,d.homesLitresCalculated,d.overallLitresCalculated,d.overallLitresReported,d.overallLitresCalculated===null||d.overallLitresReported===null?null:d.overallLitresCalculated-d.overallLitresReported,d.returnsLitres,d.rescuedLitres,d.spoiltLitres,d.validationStatus==='DISCREPANCY'?'Totals differ':'OK']:[d.date,'No End-of-Day report found',null,null,null,null,null,null,null,null,null,'No report']);
 return '\ufeff'+[header,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export async function dailyReportsRoutes(req,res,path,url,{pool,role,viewerRole}){
 const ops=path.startsWith('/operations/daily-reports')||path.startsWith('/api/operations/daily-reports'),base='/daily-reports',api='/api/daily-reports';
 const head=['viewer','registration_viewer'].includes(viewerRole);
 if(path==='/daily-reports'&&head&&req.method==='GET'){res.writeHead(303,{Location:'/operations/daily-reports'});res.end();return true;}
 if(ops){role=head?'head_of_operations':role;path=path.replace('/api/operations/daily-reports','/api/daily-reports').replace('/operations/daily-reports','/daily-reports');}
 if(![base,api,api+'/export.csv',api+'/daily-reports.js'].includes(path))return false;
 res.setHeader('Cache-Control','private, no-store');
 if(!dailyReportsAllowed(role)){
  if(path===base&&!role&&!viewerRole){res.writeHead(303,{Location:ops?'/operations':'/'});res.end();return true;}
  throw problem(role||viewerRole?403:401,'Administrator or Head of Operations access is required.');
 }
 if(req.method!=='GET')throw problem(405,'Daily Reports is read-only.');
 if(path===base){res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await pageShell(role));return true;}
 if(path===api+'/daily-reports.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(`(()=>{const nav=document.querySelector('[data-nav="daily-reports"]');if(nav){nav.classList.add('active');nav.setAttribute('aria-current','page')}const host=document.getElementById('daily-reports');fetch('${ops?'/api/operations/daily-reports':'/api/daily-reports'}',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Daily Reports could not load. Sign in again.');return r.json()}).then(data=>window.mountDailyReports(host,data,'${ops?'/api/operations/daily-reports':'/api/daily-reports'}')).catch(e=>{host.textContent=e.message;host.setAttribute('role','alert')})})();`);return true;}
 if(path===api+'/export.csv'){
  const result=await pool.query("SELECT d.* FROM daily_report_days d JOIN (SELECT id FROM daily_report_imports ORDER BY imported_at DESC LIMIT 1) i ON i.id=d.import_id WHERE d.report_type='EOD' ORDER BY d.operational_date");
  const days=result.rows.map(cleanDay),period=url.searchParams.get('month'),from=url.searchParams.get('from'),to=url.searchParams.get('to'),validDate=value=>{if(!/^2026-(0[7-9]|10)-\d{2}$/.test(value||''))return false;const date=new Date(value+'T00:00:00Z');return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value};if(period&&(!months.includes(period)||from||to))throw problem(400,'Select one report month or a date range.');if((from&&!validDate(from))||(to&&!validDate(to))||(from&&to&&from>to))throw problem(400,'Invalid report date range.');const filtered=period?days.filter(d=>d.date.startsWith(period)):days.filter(d=>(!from||d.date>=from)&&(!to||d.date<=to));
  res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="Daily_Reports_${period||'Jul-Oct-2026'}.csv"`});res.end(csvForDays(filtered));return true;
 }
 const [dayResult,storeResult,homeResult]=await Promise.all([
  pool.query("SELECT d.* FROM daily_report_days d JOIN (SELECT id FROM daily_report_imports ORDER BY imported_at DESC LIMIT 1) i ON i.id=d.import_id ORDER BY d.operational_date,d.report_type"),
  pool.query("SELECT operational_date,store_name_std,qty_1l_bottles,qty_500ml_bottles,litres_calculated FROM daily_report_store_lines WHERE import_id=(SELECT id FROM daily_report_imports ORDER BY imported_at DESC LIMIT 1) ORDER BY operational_date,store_name_std"),
  pool.query("SELECT month,distinct_home_customers,home_deliveries,home_litres,customers_all_months,customers_one_month FROM daily_report_home_monthly WHERE import_id=(SELECT id FROM daily_report_imports ORDER BY imported_at DESC LIMIT 1) ORDER BY month")
 ]);
 const result={sourceNote,months,days:dayResult.rows.map(cleanDay),stores:storeResult.rows.map(r=>({date:String(r.operational_date).slice(0,10),storeName:r.store_name_std,qty1l:n(r.qty_1l_bottles),qty500ml:n(r.qty_500ml_bottles),litres:n(r.litres_calculated)})),homeMonthly:homeResult.rows.map(r=>({month:String(r.month).slice(0,7),distinctHomeCustomers:n(r.distinct_home_customers),homeDeliveries:n(r.home_deliveries),homeLitres:n(r.home_litres),customersAllMonths:n(r.customers_all_months),customersOneMonth:n(r.customers_one_month)}))};result.calculations=dailyReportCalculations(result.days);
 res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result));return true;
}
export const dailyReportsInternals={cleanDay,months,csvCell};

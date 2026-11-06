import {retailData,retailCsv} from './collections-retail.mjs';
import {channelsData,reviewHistory,saveReview} from './collections-refinement.mjs';
import {readFile} from 'node:fs/promises';

export const collectionsAllowed = role => role === 'administrator' || role === 'finance' || role === 'head_of_operations';
const problem = (status,message) => Object.assign(new Error(message),{status});

// The supplied document stays private. Adapt its original HTML/CSS/JS, without an iframe.
// A shadow root prevents its design system from changing the CMS header or sidebar.
export function preparePresentation(html,records){
 const embedded=html.match(/const records = (\[[\s\S]*?\]);/);
 if(!embedded)throw new Error('Dashboard record block is missing.');
 const original=JSON.parse(embedded[1]);
 if(original.length!==records.length)throw new Error('Dashboard/workbook row counts differ.');
 for(let i=0;i<records.length;i++)for(const key of Object.keys(original[i])){
  if(original[i][key]!==records[i][key])throw new Error(`Dashboard/workbook mismatch at source row ${records[i].row}, field ${key}.`);
 }
 const style=html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
 const main=html.match(/<main>([\s\S]*?)<\/main>/)?.[1];
 const nav=html.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
 let script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 if(!style||!main||!nav||!script)throw new Error('Unrecognized dashboard structure.');
 script=script.replace(embedded[0],'const records = data.records;');
 script=script.slice(0,script.indexOf('function csvCell'));
 if(!script.includes('actionBody'))throw new Error('Dashboard interactions could not be preserved.');
 script=script.replaceAll('document.querySelectorAll','root.querySelectorAll').replaceAll('document.getElementById','root.getElementById');
 const markup=`<div class="app"><main><nav class="nav collections-tabs" aria-label="Collections sections">${nav}</nav>${main}</main></div>`
  .replace('onclick="window.print()"','id="printBtn"');
 if(/<script|\son[a-z]+\s*=/i.test(markup))throw new Error('Unexpected executable dashboard markup.');
 return {html:markup,css:style.replace(':root',':host')+`
 :host{display:block;min-width:0;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Arial,sans-serif}
 .app{display:block;min-height:0}main{padding:28px clamp(14px,3vw,40px);margin:0 auto}
 .collections-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:24px;padding:7px;background:var(--nav);border-radius:12px}
 .kpi-value{font-size:clamp(18px,1.8vw,28px)}
.navitem{width:auto;margin:0;flex:1;white-space:nowrap}.navitem:focus-visible{outline:3px solid #d9b772;outline-offset:2px}
 @media(max-width:480px){.kpis{grid-template-columns:1fr}.chartrow{grid-template-columns:85px minmax(30px,1fr) 65px}.statline{grid-template-columns:1fr}.control{max-width:100%}}
 @media print{.collections-tabs{display:none}}
 `,script};
}

export function exportCsv(records,params){
 const group=params.get('filter')||'All',q=(params.get('q')||'').toLocaleLowerCase(),sort=params.get('sort')||'amountDesc';
 const flag=params.get('overdue')||'all';
 const rows=records.filter(r=>(group==='All'||r.group===group)&&r.name.toLocaleLowerCase().includes(q)&&(flag==='all'||flag==='source'&&r.sourceOverdue===true||flag==='current'&&r.overdueState==='overdue'||flag==='due_unknown'&&!r.dueDate));
 rows.sort((a,b)=>sort==='nameAsc'?a.name.localeCompare(b.name):sort==='rowAsc'?a.row-b.row:sort==='amountAsc'?a.amount-b.amount:b.amount-a.amount);
 // Prevent spreadsheet formula execution without altering the stored source.
 const cell=value=>'"'+String(typeof value==='string'&&/^[\s]*[=+@\-\t\r]/.test(value)?"'"+value:value??'').replaceAll('"','""')+'"';
 return '\ufeff'+[['Original_Row','Account_Name','Listed_Amount_KES','Source_Status','Conditional_Payment_KES','Conditional_Balance_KES','Channel','Source_Overdue_Flag','Current_Overdue_Classification','Invoice_Date','Invoice_Month','Due_Date','Follow_Up_Stage'],...rows.map(r=>[r.row,r.name,r.amount,r.status,r.payment,r.balance,'Home Customers',r.sourceOverdue===null||r.sourceOverdue===undefined?'Unknown':r.sourceOverdue?'Yes':'No',r.overdueState||'Unknown',r.invoiceDate||'',r.invoiceMonth||'',r.dueDate||'',r.followUpStage||''])].map(row=>row.map(cell).join(',')).join('\r\n');
}

async function shell(role,home=false){
 const operations=role==='head_of_operations',apiBase=operations?'/api/operations/collections':'/api/collections';
 const index=await readFile(new URL(operations?'./public/operations.html':'./public/index.html',import.meta.url),'utf8');
 let workspace=index.slice(index.indexOf('<div id="workspace"'),index.indexOf('</header>')+9).replace('id="workspace" hidden','id="workspace"');
 if(role==='finance')workspace=workspace.replace(/<div class="nav-group">[\s\S]*?<\/div>/g,group=>group.includes('data-nav="home"')?group:'').replaceAll('Admin Panel','Finance').replaceAll('Administrator','Finance');
 workspace=workspace.replace(/(id="breadcrumb">)[^<]*/,(_,prefix)=>prefix+(home?'Home':'Collections'));
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Satima CMS · ${home?'Home':'Collections'}</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/collections-shell.css"><script src="/navigation.js" defer></script><script src="/collections-shell.js" defer></script><script src="/collections-retail.js" defer></script><script src="/collections-refinement.js" defer></script>${home?'':`<script src="${apiBase}/dashboard.js" defer></script>`}</head><body>${workspace}${home?'<section class="content"><h1>Finance workspace</h1><p>October receivables are available in Collections.</p><a class="primary" href="/collections">Open Collections</a></section>':'<div id="collections-dashboard"><p class="content" role="status">Loading October receivables…</p></div>'}</main></div></body></html>`;
}

export async function collectionsRoutes(req,res,path,url,{pool,role,viewerRole,readBody,actor}){
 const operations=path==='/operations/collections'||path.startsWith('/api/operations/collections');
 const headOfOperations=['viewer','registration_viewer'].includes(viewerRole);
 if(path==='/collections'&&!collectionsAllowed(role)&&headOfOperations&&req.method==='GET'){
  res.writeHead(303,{Location:'/operations/collections'});res.end();return true;
 }
 if(operations){path=path.replace('/api/operations/collections','/api/collections').replace('/operations/collections','/collections');role=headOfOperations?'head_of_operations':null;}
 const apiBase=operations?'/api/operations/collections':'/api/collections';
 const review=path.match(/^\/api\/collections\/accounts\/(\d+)\/reviews$/);
 if(!review&&!['/collections','/api/collections','/api/collections/dashboard.js','/api/collections/export.csv','/api/collections/retail/naivas/export.csv'].includes(path)&&!(path==='/'&&role==='finance'))return false;
 if(!collectionsAllowed(role)){
  if(path==='/collections'&&!role&&!viewerRole){res.writeHead(303,{Location:operations?'/operations':'/'});res.end();return true;}
  throw problem(role||viewerRole?403:401,'Admin, Finance or Head of Operations access is required.');
 }
 if(review){
  res.setHeader('Cache-Control','private, no-store');
  const row=Number(review[1]);let result;
  if(req.method==='GET')result=await reviewHistory(pool,row,url.searchParams.get('before'));
  else if(req.method==='POST')result=await saveReview(pool,row,await readBody(),`${actor||role} (${role})`);
  else throw problem(405,'Unsupported review request.');
  res.writeHead(req.method==='POST'?201:200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return true;
 }
 if(req.method!=='GET')throw problem(405,'Financial source records are read-only.');
 res.setHeader('Cache-Control','private, no-store');
 if(path==='/collections'||path==='/'){
  // Original dashboard styles include inline chart widths; script execution remains self-only.
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await shell(role,path==='/'));return true;
 }
 if(path==='/api/collections/retail/naivas/export.csv'){
  const retail=await retailData(pool);if(!retail.available)throw problem(503,'No Naivas statement has been imported.');
  res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="Naivas_Statement_Invoices.csv"'});res.end(retailCsv(retail,url.searchParams));return true;
 }
 const {rows:[snapshot]}=await pool.query("SELECT payload,presentation,workbook_sha256 FROM collections_october_snapshot WHERE id='october'");
 if(!snapshot)throw problem(503,'October source files have not been imported. Contact your administrator.');
 const {payload,presentation}=snapshot;
 if(path==='/api/collections'){
  const channels=await channelsData(pool,payload.records);
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({...channels,summary:payload.summary,sheet:payload.sheet,workbookSha256:snapshot.workbook_sha256,html:presentation.html,css:presentation.css}));return true;
 }
 if(path.endsWith('/export.csv')){
  const csv=exportCsv((await channelsData(pool,payload.records)).records,url.searchParams);
  res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="Satima_October_Receivables_Filtered.csv"'});res.end(csv);return true;
 }
 res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});
 res.end(`(async()=>{const host=document.getElementById('collections-dashboard');try{
 const response=await fetch('${apiBase}',{cache:'no-store'});if(!response.ok)throw new Error('Collections could not load. Sign in again or contact your administrator.');
 const data=await response.json(),root=host.attachShadow({mode:'open'});host.textContent='';
 root.innerHTML='<style>'+data.css+'</style>'+data.html;
 ${presentation.script}
 const values=root.querySelectorAll('.kpi-value'),s=data.summary;
 values[0].textContent='KES '+fmt(s.listed);values[1].textContent='KES '+fmt(s.unpaidLabelled);values[2].textContent='KES '+fmt(s.conditionalOutstanding);values[3].textContent=s.paidCount+' / '+s.accounts;
 const notes=root.querySelectorAll('.kpi-note');notes[0].textContent=s.accounts+' records; not independently verified billings';notes[1].textContent=s.unpaidCount+' account rows, based only on statuses';notes[2].textContent='Includes KES '+fmt(s.conditionalOutstanding-s.unpaidLabelled)+' apparent partial balance';notes[3].textContent=(s.paidCount/s.accounts*100).toFixed(1)+'% of rows · '+s.partialCount+' additional partial payer';
 const parts=[s.unpaidLabelled,s.paidLabelled,s.partialListed],labels=['Not Paid','Paid','Partial'];
 root.querySelectorAll('.stack > div').forEach((el,i)=>el.style.width=(parts[i]/s.listed*100)+'%');
 root.querySelectorAll('.legend-item').forEach((el,i)=>{el.lastChild.textContent=' '+labels[i]+' · KES '+fmt(parts[i]);});
 const lines=root.querySelectorAll('.grid2 .panel:first-child .statline b');lines[0].textContent=(s.paidCount+s.partialCount)+' of '+s.accounts+' ('+((s.paidCount+s.partialCount)/s.accounts*100).toFixed(1)+'%)';
 const shares=root.querySelectorAll('.grid2 .panel:nth-child(2) .statline b');[10,20].forEach((n,i)=>shares[i].textContent=(unpaid.slice(0,n).reduce((sum,r)=>sum+r.amount,0)/s.unpaidLabelled*100).toFixed(1)+'%');
 const conflicts=root.querySelectorAll('.conflict .n');conflicts[0].textContent='KES '+fmt(s.formulaOmission);conflicts[1].textContent='0 / '+s.accounts;conflicts[2].textContent=s.accounts;
 root.getElementById('printBtn').addEventListener('click',()=>window.print());
 root.getElementById('csvBtn').addEventListener('click',async()=>{
 const active=root.getElementById('accounts').classList.contains('active'),params=new URLSearchParams(active?{q:root.getElementById('search').value,filter:root.getElementById('filter').value,sort:root.getElementById('sort').value}:{});
 const response=await fetch('${apiBase}/export.csv?'+params,{cache:'no-store'});
 if(!response.ok){alert('Export denied. Sign in again with an authorized Collections account.');return;}
 const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='Satima_October_Receivables_Filtered.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
 });
 await window.satimaCollectionsRefinement.mount({root,data,apiBase:'${apiBase}',switchTab});
 }catch(error){host.textContent=error.message;host.setAttribute('role','alert');}})();`);
 return true;
}

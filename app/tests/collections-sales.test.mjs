import test from 'node:test';import assert from 'node:assert/strict';
import {salesData,salesCsv} from '../collections-sales.mjs';
test('monthly sales reports remain distinct from payments, balances and historical snapshot',async()=>{
 const report={period:'2026-10',summary:{homeInvoiced:100,storesInvoiced:200,totalInvoiced:300},homes:[{name:'FICTIONAL HOME',channel:'home_customers',amount:100,paymentStatus:null,invoiceDate:null,dueDate:null}],stores:[{name:'Naivas',displayName:'Naivas',code:'naivas',channel:'distributors_stores',amount:200}]};
 const july={...report,period:'2026-07',summary:{...report.summary,totalInvoiced:250}};
 const r=await salesData({query:async()=>({rows:[{id:'october-sales-2026',payload:report,reporting_month:'2026-10-01'},{id:'sales-2026-07',payload:july,reporting_month:'2026-07-01'}]})});assert.equal(r.collected,null);assert.equal(r.outstanding,null);assert.equal(r.overdue,null);assert.equal(r.homes[0].paymentStatus,null);assert.equal(r.reports.length,2);
 assert.equal(salesCsv(r,new URLSearchParams({channel:'home_customers'})).split('\r\n').length,2);assert.doesNotMatch(salesCsv(r,new URLSearchParams({channel:'home_customers'})),/Naivas/);
 assert.equal(salesCsv(r,new URLSearchParams({distributor:'naivas'})).split('\r\n').length,2);
 assert.match(salesCsv(r,new URLSearchParams({period:'2026-07'})),/July Invoices\.xls/);
 assert.equal((await salesData({query:async()=>({rows:[]})})).available,false);
});

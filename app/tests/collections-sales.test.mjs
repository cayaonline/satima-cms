import test from 'node:test';import assert from 'node:assert/strict';
import {salesData,salesCsv} from '../collections-sales.mjs';
test('sales report remains distinct from payments, balances and historical snapshot',async()=>{
 const report={period:'2030-10',summary:{homeInvoiced:100,storesInvoiced:200,totalInvoiced:300},homes:[{name:'FICTIONAL HOME',channel:'home_customers',amount:100,paymentStatus:null,invoiceDate:null,dueDate:null}],stores:[{name:'Naivas',displayName:'Naivas',code:'naivas',channel:'distributors_stores',amount:200}]};
 const r=await salesData({query:async()=>({rows:[{id:'synthetic',payload:report}]})});assert.equal(r.collected,null);assert.equal(r.outstanding,null);assert.equal(r.overdue,null);assert.equal(r.homes[0].paymentStatus,null);
 assert.equal(salesCsv(r,new URLSearchParams({channel:'home_customers'})).split('\r\n').length,2);assert.doesNotMatch(salesCsv(r,new URLSearchParams({channel:'home_customers'})),/Naivas/);
 assert.equal(salesCsv(r,new URLSearchParams({distributor:'naivas'})).split('\r\n').length,2);
 assert.equal((await salesData({query:async()=>({rows:[]})})).available,false);
});

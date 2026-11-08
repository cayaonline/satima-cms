import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceStatus,validateHomeStatus,validatePayment,enrichSalesLedger} from '../collections-ledger.mjs';

const uuid='11111111-1111-4111-8111-111111111111';

test('source payment labels preserve uncertainty and map partial balances to Unpaid',()=>{
 assert.equal(sourceStatus('Paid'),'Paid');
 assert.equal(sourceStatus('Not Paid'),'Unpaid');
 assert.equal(sourceStatus('Partially Paid'),'Unpaid');
 assert.equal(sourceStatus(null),null);
});

test('ledger enrichment retains the raw source payment label beside its normalized value',async()=>{
 const pool={query:async sql=>sql.includes('SELECT i.id::text AS invoice_id')?{rows:[]}:sql.includes('SELECT DISTINCT ON(source_report_id,source_name)')?{rows:[]}:sql.includes('FROM collections_payment_receipts p LEFT JOIN')?{rows:[]}:(()=>{throw new Error('Unexpected ledger query')})()};
 const result=await enrichSalesLedger(pool,{reports:[{id:'sales-2026-10',reportingMonth:'2026-10',homes:[{name:'Example',amount:10,sourceReference:'Sheet!A2:B2',paymentStatus:'Partially Paid'}],stores:[]}]});
 assert.equal(result.homes[0].sourcePaymentStatusRaw,'Partially Paid');
 assert.equal(result.homes[0].sourcePaymentStatus,'Unpaid');
});

test('Home Customer reviewed status is limited to Paid or Unpaid and requires an audit reason',()=>{
 const valid={period:'2026-10',accountName:'Example Home',status:'Unpaid',reason:'Confirmed against source',expectedRevision:'0'};
 assert.equal(validateHomeStatus(valid).status,'Unpaid');
 assert.throws(()=>validateHomeStatus({...valid,status:'Partial'}),/Paid or Unpaid/);
 assert.throws(()=>validateHomeStatus({...valid,reason:'ok'}),/reconciliation note/);
});

test('verified payment supports multiple distinct allocations without exceeding the receipt',()=>{
 const value=validatePayment({period:'2026-10',channel:'home_customers',payerName:'Example Home',paymentReference:'BANK-001',receivedOn:'2026-11-02',verificationReference:'Bank advice 001',paymentAmount:100,allocations:[{invoiceId:uuid,amount:60},{invoiceId:'22222222-2222-4222-8222-222222222222',amount:20}]});
 assert.equal(value.total,80);
 assert.throws(()=>validatePayment({...value,allocations:[{invoiceId:uuid,amount:101}]}),/cannot exceed the verified receipt/);
 assert.throws(()=>validatePayment({...value,allocations:[{invoiceId:uuid,amount:10},{invoiceId:uuid,amount:10}]}),/distinct invoice rows/);
});

test('ledger enrichment calculates cohort collections and outstanding while leaving due dates unclassified',async()=>{
 const invoice={invoice_id:uuid,source_report_id:'october-sales-2026',channel:'home_customers',source_reference:'Sheet!A2:B2',source_name:'Example Home',customer_id:null,invoice_date:null,due_date:null,source_payment_status:null,amount:'100.00',collected:'30.00',credits:'5.00',allocated:'30.00',payment_history:[]};
 const pool={query:async sql=>{
  if(sql.includes('SELECT i.id::text AS invoice_id'))return {rows:[invoice]};
  if(sql.includes('SELECT DISTINCT ON(source_report_id,source_name)'))return {rows:[]};
  if(sql.includes('FROM collections_payment_receipts p LEFT JOIN'))return {rows:[]};
  throw new Error('Unexpected ledger query');
 }};
 const report={id:'october-sales-2026',reportingMonth:'2026-10',available:true,homes:[{name:'Example Home',amount:100,sourceReference:'Sheet!A2:B2',paymentStatus:null}],stores:[]};
 const result=await enrichSalesLedger(pool,{reports:[report]});
 assert.equal(result.homes[0].invoiceId,uuid);
 assert.equal(result.homes[0].collectedAmount,30);
 assert.equal(result.homes[0].creditAmount,5);
 assert.equal(result.homes[0].outstandingAmount,65);
 assert.equal(result.homes[0].paymentStatus,'Unpaid');
 assert.equal(result.homes[0].dueDate,null);
});

test('a fully reversed receipt does not initialise a customer as Paid',async()=>{
 const pool={query:async sql=>sql.includes('SELECT i.id::text AS invoice_id')?{rows:[{invoice_id:uuid,source_report_id:'october-sales-2026',channel:'home_customers',source_reference:'Sheet!A2:B2',source_name:'Example Home',amount:'100.00',collected:'0.00',credits:'0.00',allocated:'40.00',payment_history:[]}]}:sql.includes('SELECT DISTINCT ON(source_report_id,source_name)')?{rows:[]}:sql.includes('FROM collections_payment_receipts p LEFT JOIN')?{rows:[]}:(()=>{throw new Error('Unexpected ledger query')})()};
 const result=await enrichSalesLedger(pool,{reports:[{id:'october-sales-2026',reportingMonth:'2026-10',homes:[{name:'Example Home',amount:100,sourceReference:'Sheet!A2:B2'}],stores:[]}]});
 assert.equal(result.homes[0].paymentStatus,null);
});

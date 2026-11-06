import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {summarizeRetail,filterRetail,retailCsv} from '../collections-retail.mjs';
const records=[{row:2,branch:'Fictional A',purchaseOrder:' TEST ',invoice:'INV1',date:'2030-10-01',dueDate:'2030-10-31',amount:100,flags:[],raw:{A:{value:'01/10/2030'},E:{value:'INV1'}}},{row:3,branch:'Fictional B',purchaseOrder:'=BAD()',invoice:'INV1',date:'2031-10-01',dueDate:'2030-10-31',amount:50,flags:['invoice_date_outside_period'],raw:{A:{value:'48118'},E:{value:'INV1'}}}];
const statement={dataset_id:'synthetic',period_start:'2030-10-01',period_end:'2030-10-31',payload:{sheet:'Synthetic',controls:{invoiced:150,paid:0,balance:150},summary:{invoiceRows:2,listedInvoices:150}}};
test('statement totals retain out-of-period rows and do not imply verified payments or deliveries',()=>{const r=summarizeRetail(records,statement,[{status:'open'}]);assert.equal(r.billedValue,150);assert.equal(r.datedWithinPeriod,100);assert.equal(r.datedOutsidePeriod,50);assert.equal(r.outsidePeriodRows,1);assert.equal(r.statementPaid,0);assert.equal(r.verifiedCollections,null);assert.equal(r.remittanceValue,null);assert.equal(r.suppliedValue,null);assert.equal(r.reconciled,false);assert.equal(r.branches.length,2);assert.throws(()=>summarizeRetail(records.slice(1),statement,[]),e=>e.status===503);});
test('retailer exports keep raw source fields, filter exactly and neutralize spreadsheet formulas',()=>{const r=summarizeRetail(records,statement,[]);assert.equal(filterRetail(records,new URLSearchParams({branch:'Fictional B'})).length,1);assert.equal(filterRetail(records,new URLSearchParams({flag:'flagged'}))[0].row,3);assert.equal(filterRetail(records,new URLSearchParams({q:'TEST'}))[0].row,2);assert.match(retailCsv(r,new URLSearchParams()),/"'=BAD\(\)"/);assert.match(retailCsv(r,new URLSearchParams()),/" TEST "/);assert.equal(retailCsv(r,new URLSearchParams({flag:'flagged'})).split('\r\n').length,2);});
test('source parser preserves Excel serial years, duplicate references, and missing evidence',()=>{
 const result=spawnSync('python3',['-c',`
import importlib.util,sys
spec=importlib.util.spec_from_file_location('source',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert m.date_value('46690.0')=='2027-10-30'
assert m.date_value('1',True)=='1904-01-02'
c={}
def put(ref,v):c[ref]={'value':v,'type':None,'formula':None,'style':None}
put('A1','Naivas HQ Customer Statement From 01/10/2026 To 31/10/2026')
for row,label,value in [(3,'Invoiced Amount','KES 150.00'),(4,'Amount Paid','KES 0.00'),(5,'Balance Due','KES 150.00')]:put('A'+str(row),label);put('D'+str(row),value)
for col,value in zip('ABCDEF',['Date','Store','PO#','Transactions','Details','Amount']):put(col+'8',value)
for row,date,amount,po in [(9,'01/10/2026','100','TEST1'),(10,'46690.0','50',' TEST2 ')]:
 for col,value in zip('ABCDEF',[date,'FICTIONAL BRANCH',po,'Invoice','INV001 - due on 31/10/2026',amount]):put(col+str(row),value)
r=m.analyze(c,'Synthetic');assert r['summary']['listedInvoices']==150;assert r['summary']['datedOutsidePeriod']==50;assert r['records'][1]['date']=='2027-10-30';assert r['controls']['paid']==0
codes={e['code'] for e in r['exceptions']};assert codes=={'invoice_date_outside_period','due_before_invoice','purchase_order_whitespace','repeated_invoice_reference'}
assert r['records'][1]['raw']['A']['value']=='46690.0'
put('F10','-50')
try:m.analyze(c,'Synthetic');raise AssertionError('negative invoice accepted')
except ValueError:pass
print('PASS')
`,fileURLToPath(new URL('../scripts/read-naivas-statement.py',import.meta.url))],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PASS/);
});

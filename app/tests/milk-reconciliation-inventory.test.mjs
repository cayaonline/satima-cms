import test from 'node:test';
import assert from 'node:assert/strict';
import {periodCoverage,reconcileMetric} from '../milk-reconciliation.mjs';
import {openingInput} from '../milk-inventory.mjs';

test('historical weeks need verified contiguous boundaries before comparison',()=>{
 const weeks=[{week_start:'2026-09-01',week_end:'2026-09-15'},{week_start:'2026-09-16',week_end:'2026-09-30'}];
 assert.equal(periodCoverage(weeks,2026,9),true);
 assert.equal(periodCoverage([{...weeks[0],week_end:null},weeks[1]],2026,9),false);
 assert.equal(periodCoverage([{...weeks[0],week_end:'2026-09-14'},weeks[1]],2026,9),false);
});
test('reconciliation keeps absent transactions distinct from a proven difference',()=>{
 const base={reported:'5',recorded:'3',recordCount:1,sourceComplete:true,periodCompatible:true,definitionCompatible:true};
 assert.deepEqual([reconcileMetric(base).status,reconcileMetric({...base,recorded:'5.000000'}).status],['difference_detected','reconciled']);
 assert.equal(reconcileMetric({...base,recordCount:0}).difference_liters,null);
 assert.equal(reconcileMetric({...base,periodCompatible:false}).status,'not_comparable');
 assert.equal(reconcileMetric({...base,definitionCompatible:false}).status,'not_comparable');
 assert.equal(reconcileMetric({...base,reported:null}).status,'incomplete');
});
test('opening balance requires explicit source and precise positive stock',()=>{
 const base={stock_type:'raw',quantity_liters:'0.000001',effective_on:'2026-09-30',source_reference:'Physical stock count 42',verification_notes:'Count signed by operations manager',idempotency_key:'11111111-1111-4111-8111-111111111111'};
 assert.equal(openingInput(base).quantity_liters,'0.000001');
 for(const quantity_liters of ['0','-1','0.0000001','abc'])assert.throws(()=>openingInput({...base,quantity_liters}));
 assert.throws(()=>openingInput({...base,source_reference:''}));
 assert.throws(()=>openingInput({...base,effective_on:'2026-02-30'}));
});

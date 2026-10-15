import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedPhone,planSync} from '../scripts/master-sync-core.mjs';

test('Kenyan phone forms normalize to one identity',()=>{
 assert.equal(normalizedPhone('0712 345 678'),'+254712345678');
 assert.equal(normalizedPhone('+254 712 345 678'),'+254712345678');
 assert.equal(normalizedPhone('0112 345 678'),'+254112345678');
 assert.equal(normalizedPhone('unknown'),null);
});
test('only deterministic matches update; blanks preserve existing values',()=>{
 const existing=[{id:'one',customer_id:'C0001',full_name:'Example Person',phone_number:'0712345678',physical_address:'Old',category:'Current Customers'}];
 const plan=planSync('customers',[{source_row:2,full_name:' EXAMPLE   PERSON ',phone_number:'+254712345678',physical_address:'New',category:''}],existing);
 assert.equal(plan[0].result,'updated');
 assert.equal(plan[0].record_id,'one');
 assert.equal(plan[0].changes.category,undefined);
 assert.equal(plan[0].changes.physical_address.to,'New');
});
test('ambiguous names and phones stay in review and repeated rows do not add duplicates',()=>{
 const existing=[{id:'one',customer_id:'C0001',full_name:'Example Person',phone_number:'0712345678'}];
 const plan=planSync('customers',[
  {source_row:2,full_name:'Example Person',phone_number:'0712000000'},
  {source_row:3,full_name:'New Person',phone_number:'0112345678'},
  {source_row:4,full_name:'New Person',phone_number:'0112345678'}
 ],existing);
 assert.deepEqual(plan.map(row=>row.result),['review','added','review']);
});
test('stable IDs never override a conflicting person',()=>{
 const existing=[{id:'one',customer_id:'C0001',full_name:'Example Person',phone_number:'0712345678'}];
 const plan=planSync('customers',[{source_row:2,customer_id:'C0001',full_name:'Another Person',phone_number:'0112345678'}],existing);
 assert.equal(plan[0].result,'review');
});

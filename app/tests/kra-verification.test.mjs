import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {normalizedPin,pinFormat,compareNames,officialCheck,recordKraCheck,listKra} from '../kra-verification.mjs';
import {pool,createFarmer,updateFarmer} from '../store.mjs';
after(()=>pool.end());

test('shared KRA UI renders dedicated category links, first-column actions, and restores saved PIN status',()=>{
 const browser={};runInNewContext(readFileSync(new URL('../public/kra-ui.js',import.meta.url),'utf8'),{window:browser});
 const cards=browser.kraUI.cards({total:23,verified:2,pending:21,invalid:2,missing:6,review:8},'/farmers/kra-verification');
 assert.equal((cards.match(/class="stat kra-stat"/g)||[]).length,6);
 assert.match(cards,/href="\/farmers\/kra-verification\/missing"/);
 assert.equal(browser.kraUI.route('/farmers/kra-verification/missing','/farmers/kra-verification').bucket,'missing');
 assert.equal(browser.kraUI.route('/operations/kra-verification/verified','/operations/kra-verification').title,'PINs verified with KRA');
 assert.equal(browser.kraUI.route('/farmers/kra-verification/unknown','/farmers/kra-verification'),null);
 const table=browser.kraUI.table({records:[{id:'one',customer_id:'SF-F-0001',full_name:'Farmer',kra_pin:'P123456789A',format:'valid',kra_status:'verified',name_match:'exact'}],pagination:{total:1,total_pages:1}},1);
 assert.match(table,/<th>Action<\/th><th>Farmer ID<\/th>/);
 assert.match(table,/<td><button class="link-button" data-kra-review="one">Review \/ Verify<\/button><\/td>/);
 const select={value:''},previous={textContent:''},form={elements:{pin_status:select},querySelector:()=>previous};
 browser.kraUI.restorePinStatus(form,{farmer:{kra_pin:'P123456789A'},history:[{pin_snapshot:'P123456789A',pin_status:'Inactive'}]});
 assert.equal(select.value,'Inactive');
 browser.kraUI.restorePinStatus(form,{farmer:{kra_pin:'P123456789A'},history:[{pin_snapshot:'P123456789A',pin_status:'Not Available'}]});
 assert.equal(select.value,'Unable to Confirm');
});

test('PIN format is distinct from official verification',()=>{
 assert.equal(normalizedPin(' p123456789a '),'P123456789A');
 for(const pin of ['P123456789A','a000000000z'])assert.equal(pinFormat(pin),'valid');
 for(const pin of ['',null])assert.equal(pinFormat(pin),'missing');
 for(const pin of ['P12345678A','X123456789A','P1234567891','P123456789AB'])assert.equal(pinFormat(pin),'invalid');
 assert.rejects(officialCheck(),error=>error.status===503);
});
test('name comparison handles case, punctuation, ordering and middle names without claiming an approximate match is exact',()=>{
 assert.equal(compareNames('Susan Maina Wakuru','WAKURU, SUSAN MAINA'),'exact');
 assert.equal(compareNames('Susan Maina Wakuru','Susan Wakuru'),'possible');
 assert.equal(compareNames('Susan Maina Wakuru','Peter Kariuki'),'mismatch');
 assert.equal(compareNames('Susan Maina Wakuru',''),'not_checked');
});
test('manual check records an append-only audit row and rejects invalid PINs',async()=>{
 const farmer={id:'id',customer_id:'SF-F-0001',full_name:'Susan Maina Wakuru',kra_pin:'P123456789A'};
 const calls=[];const c={async query(sql,values){calls.push({sql,values});if(sql.includes('FROM farmers'))return {rows:[farmer]};if(sql.includes('SELECT id,outcome,pin_snapshot'))return {rows:[]};if(sql.includes('INSERT INTO farmer_kra_verifications'))return {rows:[{id:1,outcome:'verified',name_match:'possible'}]};throw new Error('Unexpected SQL');}};
 const input={outcome:'verified',taxpayer_name:'Susan Wakuru',pin_status:'Active',checked_at:'2026-10-12',checked_by:'Accountant',remarks:'Checked official site',expected_pin:'P123456789A',expected_revision:null};
 const result=await recordKraCheck(c,'id',input,'Administrator');
 assert.equal(result.outcome,'verified');assert.equal(calls.length,3);assert(calls[2].sql.includes('INSERT INTO farmer_kra_verifications'));
 assert.equal(calls[2].values[2],'pending');assert.equal(calls[2].values[6],'possible');
 await assert.rejects(recordKraCheck(c,'id',{...input,checked_at:'2026-02-31'},'Administrator'),error=>error.status===400);
 await assert.rejects(recordKraCheck(c,'id',{...input,pin_status:'Unable to Confirm'},'Administrator'),error=>error.status===400);
 await assert.rejects(recordKraCheck(c,'id',{...input,pin_status:'Unstructured status'},'Administrator'),error=>error.status===400);
 farmer.kra_pin='BAD';await assert.rejects(recordKraCheck(c,'id',{...input,expected_pin:'BAD'},'Administrator'),error=>error.status===400);
});
test('verification search is parameterized and returns formats without changing PINs',async()=>{
 const queries=[];const db={async query(sql,values=[]){queries.push({sql,values});if(sql.includes('SELECT count(*)::int total,count(*) FILTER'))return {rows:[{total:2,missing:1,invalid:0,verified:0,review:1}]};if(sql.includes('SELECT count(*)::int total'))return {rows:[{total:1}]};return {rows:[{id:'id',customer_id:'SF-F-0001',full_name:'Name',kra_pin:'P123456789A',kra_pin_format:'valid',kra_status:'pending',name_match:'not_checked',pin_snapshot:null}]};}};
 const result=await listKra(db,new URLSearchParams({q:"P%_'",page:'1'}));
 assert.equal(result.records[0].format,'valid');assert.equal(result.stats.pending,2);
 assert(queries[1].values[0].includes('\\%\\_'));assert(!queries[1].sql.includes("P%_'"));
 await assert.rejects(listKra(db,new URLSearchParams({page:'0'})),error=>error.status===400);
 await assert.rejects(listKra(db,new URLSearchParams({bucket:'unknown'})),error=>error.status===400);
});
test('isolated database stores format, detects duplicates, preserves manual audit, and invalidates a check after PIN correction',{skip:process.env.TEST_ISOLATED_DATABASE!=='1'},async()=>{
 const c=await pool.connect();await c.query('BEGIN');try{
  const first=await createFarmer(c,{full_name:'TEST KRA FARMER',primary_phone:'TEST-KRA-1',registered_by:'TEST',kra_pin:' a987654321z '});
  const second=await createFarmer(c,{full_name:'TEST KRA SECOND',primary_phone:'TEST-KRA-2',registered_by:'TEST',kra_pin:'invalid'});
  const missing=await createFarmer(c,{full_name:'TEST KRA MISSING',primary_phone:'TEST-KRA-4',registered_by:'TEST'});
  const {rows:[stored]}=await c.query('SELECT kra_pin,kra_pin_format FROM farmers WHERE id=$1',[first.id]);assert.equal(stored.kra_pin,'A987654321Z');assert.equal(stored.kra_pin_format,'valid');
  assert.equal((await c.query('SELECT kra_pin_format FROM farmers WHERE id=$1',[second.id])).rows[0].kra_pin_format,'invalid');
  await c.query('SAVEPOINT duplicate_check');
  await assert.rejects(createFarmer(c,{full_name:'TEST KRA DUPLICATE',primary_phone:'TEST-KRA-3',registered_by:'TEST',kra_pin:'A987654321Z'}),error=>error.code==='23505');
  await c.query('ROLLBACK TO SAVEPOINT duplicate_check');
  const flagged=await recordKraCheck(c,second.id,{outcome:'needs_review',checked_at:'2026-10-12',checked_by:'TEST ACCOUNTANT',remarks:'Malformed source PIN',expected_pin:'invalid',expected_revision:null},'operations','Operations');
  assert.equal(flagged.outcome,'needs_review');
  assert.equal((await c.query('SELECT method,source_portal FROM farmer_kra_verifications WHERE id=$1',[flagged.id])).rows[0].method,'manual_review');
  const missingFlag=await recordKraCheck(c,missing.id,{outcome:'needs_review',checked_at:'2026-10-12',checked_by:'TEST ACCOUNTANT',expected_pin:'',expected_revision:null},'operations','Operations');
  assert.equal(missingFlag.outcome,'needs_review');
  assert.equal((await listKra(c,new URLSearchParams({q:'TEST KRA MISSING'}))).records[0].kra_status,'needs_review');
  assert.equal((await listKra(c,new URLSearchParams({bucket:'invalid',q:'TEST KRA'}))).pagination.total,1);
  assert.equal((await listKra(c,new URLSearchParams({bucket:'missing',q:'TEST KRA'}))).pagination.total,1);
  assert.equal((await listKra(c,new URLSearchParams({bucket:'review',q:'TEST KRA'}))).pagination.total,2);
  assert.equal((await listKra(c,new URLSearchParams({bucket:'pending',q:'TEST KRA'}))).pagination.total,3);
  assert.equal((await listKra(c,new URLSearchParams({bucket:'invalid',q:'TEST KRA MISSING'}))).pagination.total,0);
  const result=await recordKraCheck(c,first.id,{outcome:'verified',taxpayer_name:'TEST KRA FARMER',pin_status:'Active',checked_at:'2026-10-12',checked_by:'TEST ACCOUNTANT',expected_pin:'A987654321Z',expected_revision:null},'Administrator');
  assert.equal(result.name_match,'exact');
  assert.equal((await listKra(c,new URLSearchParams({bucket:'verified',q:'TEST KRA'}))).pagination.total,1);
  assert.equal((await listKra(c,new URLSearchParams({bucket:'pending',q:'TEST KRA'}))).pagination.total,2);
  const listed=await listKra(c,new URLSearchParams({q:'TEST KRA FARMER'}));assert.equal(listed.records.find(r=>r.id===first.id)?.kra_status,'verified');
  const revision=(await c.query('SELECT updated_at::text revision FROM farmers WHERE id=$1',[first.id])).rows[0].revision;
  await updateFarmer(c,first.id,{full_name:'TEST KRA FARMER',primary_phone:'TEST-KRA-1',registered_by:'TEST',kra_pin:'P987654321B',revision});
  const after=await listKra(c,new URLSearchParams({q:'TEST KRA FARMER'}));assert.equal(after.records.find(r=>r.id===first.id)?.kra_status,'pending');
  assert.equal((await c.query('SELECT count(*)::int n FROM farmer_kra_verifications WHERE farmer_id=$1',[first.id])).rows[0].n,1);
 }finally{await c.query('ROLLBACK');c.release();}
});

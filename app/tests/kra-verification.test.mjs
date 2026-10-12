import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {normalizedPin,pinFormat,compareNames,officialCheck,recordKraCheck,listKra} from '../kra-verification.mjs';
import {pool,createFarmer,updateFarmer} from '../store.mjs';
after(()=>pool.end());

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
 const calls=[];const c={async query(sql,values){calls.push({sql,values});if(sql.includes('FROM farmers'))return {rows:[farmer]};if(sql.includes('SELECT outcome,pin_snapshot'))return {rows:[]};if(sql.includes('INSERT INTO farmer_kra_verifications'))return {rows:[{id:1,outcome:'verified',name_match:'possible'}]};throw new Error('Unexpected SQL');}};
 const input={outcome:'verified',taxpayer_name:'Susan Wakuru',pin_status:'Active',checked_at:'2026-10-12',checked_by:'Accountant',remarks:'Checked official site'};
 const result=await recordKraCheck(c,'id',input,'Administrator');
 assert.equal(result.outcome,'verified');assert.equal(calls.length,3);assert(calls[2].sql.includes('INSERT INTO farmer_kra_verifications'));
 assert.equal(calls[2].values[2],'pending');assert.equal(calls[2].values[6],'possible');
 await assert.rejects(recordKraCheck(c,'id',{...input,checked_at:'2026-02-31'},'Administrator'),error=>error.status===400);
 farmer.kra_pin='BAD';await assert.rejects(recordKraCheck(c,'id',input,'Administrator'),error=>error.status===400);
});
test('verification search is parameterized and returns formats without changing PINs',async()=>{
 const queries=[];const db={async query(sql,values=[]){queries.push({sql,values});if(sql.includes('SELECT count(*)::int total,count(*) FILTER'))return {rows:[{total:2,missing:1,invalid:0,verified:0,review:1}]};if(sql.includes('SELECT count(*)::int total'))return {rows:[{total:1}]};return {rows:[{id:'id',customer_id:'SF-F-0001',full_name:'Name',kra_pin:'P123456789A',kra_pin_format:'valid',kra_status:'pending',name_match:'not_checked',pin_snapshot:null}]};}};
 const result=await listKra(db,new URLSearchParams({q:"P%_'",page:'1'}));
 assert.equal(result.records[0].format,'valid');assert.equal(result.stats.pending,2);
 assert(queries[1].values[0].includes('\\%\\_'));assert(!queries[1].sql.includes("P%_'"));
 await assert.rejects(listKra(db,new URLSearchParams({page:'0'})),error=>error.status===400);
});
test('isolated database stores format, detects duplicates, preserves manual audit, and invalidates a check after PIN correction',{skip:process.env.TEST_ISOLATED_DATABASE!=='1'},async()=>{
 const c=await pool.connect();await c.query('BEGIN');try{
  const first=await createFarmer(c,{full_name:'TEST KRA FARMER',primary_phone:'TEST-KRA-1',registered_by:'TEST',kra_pin:' a987654321z '});
  const second=await createFarmer(c,{full_name:'TEST KRA SECOND',primary_phone:'TEST-KRA-2',registered_by:'TEST',kra_pin:'invalid'});
  const {rows:[stored]}=await c.query('SELECT kra_pin,kra_pin_format FROM farmers WHERE id=$1',[first.id]);assert.equal(stored.kra_pin,'A987654321Z');assert.equal(stored.kra_pin_format,'valid');
  assert.equal((await c.query('SELECT kra_pin_format FROM farmers WHERE id=$1',[second.id])).rows[0].kra_pin_format,'invalid');
  await c.query('SAVEPOINT duplicate_check');
  await assert.rejects(createFarmer(c,{full_name:'TEST KRA DUPLICATE',primary_phone:'TEST-KRA-3',registered_by:'TEST',kra_pin:'A987654321Z'}),error=>error.code==='23505');
  await c.query('ROLLBACK TO SAVEPOINT duplicate_check');
  const result=await recordKraCheck(c,first.id,{outcome:'verified',taxpayer_name:'TEST KRA FARMER',pin_status:'Active',checked_at:'2026-10-12',checked_by:'TEST ACCOUNTANT'},'Administrator');
  assert.equal(result.name_match,'exact');
  const listed=await listKra(c,new URLSearchParams({q:'TEST KRA FARMER'}));assert.equal(listed.records.find(r=>r.id===first.id)?.kra_status,'verified');
  const revision=(await c.query('SELECT updated_at::text revision FROM farmers WHERE id=$1',[first.id])).rows[0].revision;
  await updateFarmer(c,first.id,{full_name:'TEST KRA FARMER',primary_phone:'TEST-KRA-1',registered_by:'TEST',kra_pin:'P987654321B',revision});
  const after=await listKra(c,new URLSearchParams({q:'TEST KRA FARMER'}));assert.equal(after.records.find(r=>r.id===first.id)?.kra_status,'pending');
  assert.equal((await c.query('SELECT count(*)::int n FROM farmer_kra_verifications WHERE farmer_id=$1',[first.id])).rows[0].n,1);
 }finally{await c.query('ROLLBACK');c.release();}
});

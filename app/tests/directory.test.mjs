import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {directoryQuery,listFarmers} from '../directory.mjs';
import {listOperationsFarmers} from '../operations-directory.mjs';
import {pool,createFarmer,updateFarmer,optionalFarmerAttributes,genderEvidence} from '../store.mjs';
after(()=>pool.end());
const params=o=>new URLSearchParams(o);
test('optional farmer attributes retain unknowns and accept only documented values',()=>{
 assert.deepEqual(optionalFarmerAttributes({}),{date_of_birth:null,preferred_language:null});
 assert.deepEqual(optionalFarmerAttributes({date_of_birth:'1990-04-05',preferred_language:'Kiswahili'}),{date_of_birth:'1990-04-05',preferred_language:'Kiswahili'});
 for(const date of ['2026-02-30','invalid',123])assert.throws(()=>optionalFarmerAttributes({date_of_birth:date}),error=>error.status===400);
 assert.throws(()=>optionalFarmerAttributes({preferred_language:'French'}),error=>error.status===400);
 assert.equal(genderEvidence({gender:'female',gender_source:'supplier_document'}).gender_source,'supplier_document');
});
test('gender stays unverified until sourced and filters are exact in both portals',{skip:process.env.TEST_ISOLATED_DATABASE!=='1'},async()=>{
 const c=await pool.connect();await c.query('BEGIN');try{
  const a=await createFarmer(c,{full_name:'ISOLATED GENDER A',primary_phone:'GENDER-A',registered_by:'TEST',category:'Others'});
  const b=await createFarmer(c,{full_name:'ISOLATED GENDER B',primary_phone:'GENDER-B',registered_by:'TEST',category:'Others',gender:'female',gender_source:'registration_document'});
  assert.equal((await c.query('SELECT gender FROM farmers WHERE id=$1',[a.id])).rows[0].gender,'not_verified');
  const revision=(await c.query('SELECT updated_at::text AS revision FROM farmers WHERE id=$1',[a.id])).rows[0].revision;
  await updateFarmer(c,a.id,{full_name:'ISOLATED GENDER A',primary_phone:'GENDER-A',registered_by:'TEST',category:'Others',gender:'male',gender_source:'farmer_confirmation',revision});
  for(const list of [listFarmers,listOperationsFarmers]){
   assert.equal((await list(c,params({q:'Male',category:'Others'}))).stats.total,1);
   assert.equal((await list(c,params({q:'Female',category:'Others'}))).stats.total,1);
   assert.equal((await list(c,params({gender:'male',category:'Others'}))).farmers[0].id,a.id);
   assert.equal((await list(c,params({gender:'female',category:'Others'}))).farmers[0].id,b.id);
   assert.equal((await list(c,params({gender:'not_verified',category:'Others'}))).stats.total,0);
  }
 }finally{await c.query('ROLLBACK');c.release();}
});
test('directory validates structured filters and keeps free text parameterized',()=>{
 const query=directoryQuery(params({q:'100%_\\literal',sort:'customer_id',direction:'asc'}));assert(query.sql.includes('::numeric asc'));assert(query.values.includes('%100\\%\\_\\\\literal%'));assert(!query.sql.includes('literal'));assert.equal(query.pageSize,50);
 const defaults=directoryQuery(params({}));assert.equal(defaults.sort,'customer_id');assert.equal(defaults.direction,'asc');assert(defaults.sql.includes('::numeric asc NULLS LAST'));
 for(const o of [{page:'0'},{page:'1.5'},{page_size:'501'},{sort:'id; DROP TABLE farmers'},{direction:'other'},{scope:'unknown'},{scope:'demo'},{status:'verified'},{review:'unknown'},{category:'Unknown'},{registration:'other'},{q:'x'.repeat(101)}])assert.throws(()=>directoryQuery(params(o)),e=>e.status===400);
});
test('current supplier master drives both portals while historical farmers remain reviewable',{skip:process.env.TEST_ISOLATED_DATABASE!=='1'},async()=>{
 const c=await pool.connect();await c.query('BEGIN');try{
  const current=await createFarmer(c,{full_name:'ISOLATED MASTER CURRENT',primary_phone:'MASTER-CURRENT',registered_by:'TEST',category:'Satima Farmers'});
  const historical=await createFarmer(c,{full_name:'ISOLATED MASTER HISTORICAL',primary_phone:'MASTER-HISTORICAL',registered_by:'TEST',category:'Others'});
  const awaiting=await createFarmer(c,{full_name:'ISOLATED MASTER AWAITING',primary_phone:'MASTER-AWAITING',registered_by:'TEST'});
  await c.query("UPDATE farmers SET master_list_status='historical' WHERE id=$1",[historical.id]);
  await c.query("UPDATE farmers SET master_list_status='historical' WHERE id=$1",[awaiting.id]);
  await c.query("INSERT INTO farmer_data_issues(farmer_id,field_name,description) VALUES($1,'master_supplier_list','Absent from current list')",[historical.id]);
  for(const list of [listFarmers,listOperationsFarmers]){
   const directory=await list(c,params({q:'ISOLATED MASTER'}));
   assert.equal(directory.stats.total,2);assert.deepEqual(new Set(directory.farmers.map(f=>f.id)),new Set([current.id,awaiting.id]));
   assert.equal(directory.stats.categories['Satima Farmers'],1);assert.equal(directory.stats.categories.Others,0);
  }
  assert.equal((await listFarmers(c,params({q:'ISOLATED MASTER',scope:'all'}))).stats.total,3);
  const awaitingList=await listFarmers(c,params({q:'ISOLATED MASTER',category:'unassigned'}));
  assert.equal(awaitingList.stats.total,1);assert.equal(awaitingList.farmers[0].id,awaiting.id);
  const review=await listFarmers(c,params({q:'ISOLATED MASTER',review:'open'}));
  assert.equal(review.stats.total,1);assert.equal(review.farmers[0].id,historical.id);
 }finally{await c.query('ROLLBACK');c.release();}
});
test('category and registration filters combine; an unregistered profile gets one Farmer ID when completed',{skip:process.env.TEST_ISOLATED_DATABASE!=='1'},async()=>{
 const c=await pool.connect();await c.query('BEGIN');try{
  const registered=await createFarmer(c,{full_name:'ISOLATED REGISTERED',primary_phone:'TEST-REGISTERED',registered_by:'TEST',category:'Satima Farmers'});
  const {rows:[lead]}=await c.query("INSERT INTO farmers(customer_id,full_name,primary_phone,registered_by,registration_date,category,registration_status) VALUES(NULL,'ISOLATED UNREGISTERED','TEST-UNREGISTERED',NULL,NULL,'Larger Sagana Farmers','not_registered') RETURNING id");
  const all=await listFarmers(c,params({q:'ISOLATED'}));assert.equal(all.stats.total,2);assert.equal(all.stats.registered,1);assert.equal(all.stats.not_registered,1);assert.equal(all.stats.categories['Larger Sagana Farmers'],1);
  const filtered=await listFarmers(c,params({category:'Larger Sagana Farmers',registration:'not_registered',q:'UNREGISTERED'}));assert.equal(filtered.stats.total,1);assert.equal(filtered.farmers[0].customer_id,null);
  assert.equal((await listFarmers(c,params({category:'Satima Farmers',registration:'not_registered'}))).stats.total,0);
  let revision=(await c.query('SELECT updated_at::text AS revision FROM farmers WHERE id=$1',[lead.id])).rows[0].revision;
  await updateFarmer(c,lead.id,{full_name:'ISOLATED UNREGISTERED',primary_phone:'TEST-UNREGISTERED',registration_status:'not_registered',category:'Others',revision});
  assert.equal((await listFarmers(c,params({category:'Others',registration:'not_registered'}))).stats.total,1);
  revision=(await c.query('SELECT updated_at::text AS revision FROM farmers WHERE id=$1',[lead.id])).rows[0].revision;
  await assert.rejects(()=>updateFarmer(c,lead.id,{full_name:'ISOLATED UNREGISTERED',primary_phone:'TEST-UNREGISTERED',registered_by:'TEST',registration_status:'registered',category:'Others',revision}),e=>e.status===400);
  const result=await updateFarmer(c,lead.id,{full_name:'ISOLATED UNREGISTERED',primary_phone:'TEST-UNREGISTERED',registered_by:'TEST',registration_date:'2026-10-10',registration_status:'registered',category:'Others',revision});
  assert.equal(result.id,lead.id);
  const {rows:[completed]}=await c.query('SELECT customer_id,category,registration_status FROM farmers WHERE id=$1',[lead.id]);assert.match(completed.customer_id,/^SF-F-\d{4,}$/);assert.equal(completed.category,'Others');assert.equal(completed.registration_status,'registered');assert.notEqual(completed.customer_id,registered.customer_id);
  assert.equal((await listFarmers(c,params({category:'Others',registration:'registered'}))).stats.total,1);
  assert.equal((await c.query('SELECT count(*)::int AS n FROM farmers WHERE id=$1',[lead.id])).rows[0].n,1);
  await createFarmer(c,{full_name:'ISOLATED PHONE OWNER',primary_phone:'0712345678',registered_by:'TEST'});
  const unassigned=await listFarmers(c,params({category:'unassigned',registration:'registered',q:'ISOLATED PHONE OWNER'}));assert.equal(unassigned.stats.total,1);assert.equal(unassigned.farmers[0].category,null);
  const {rows:[uncertain]}=await c.query("INSERT INTO farmers(customer_id,full_name,registration_date,registration_status,category) VALUES(NULL,'ISOLATED UNCERTAIN',NULL,'review_required','Others') RETURNING id,updated_at::text AS revision");
  const {rows:[issue]}=await c.query("INSERT INTO farmer_data_issues(farmer_id,field_name,description) VALUES($1,'registration_match','ISOLATED IDENTITY REVIEW') RETURNING id",[uncertain.id]);
  const completion={full_name:'ISOLATED UNCERTAIN',primary_phone:'0712345678',registered_by:'TEST',registration_date:'2026-10-10',registration_status:'registered',category:'Others',revision:uncertain.revision};
  await assert.rejects(()=>updateFarmer(c,uncertain.id,completion),e=>e.status===409&&e.message.includes('identity review'));
  await c.query("UPDATE farmer_data_issues SET status='resolved',resolution_note='ISOLATED REVIEW COMPLETE',resolved_at=now() WHERE id=$1",[issue.id]);
  await assert.rejects(()=>updateFarmer(c,uncertain.id,completion),e=>e.status===409&&e.message.includes('existing registration'));
 }finally{await c.query('ROLLBACK');c.release();}
});
test('each supplier category and awaiting-categorization list uses exact stored categories and updates after editing',{skip:process.env.TEST_ISOLATED_DATABASE!=='1'},async()=>{
 const c=await pool.connect();await c.query('BEGIN');try{
  const categories=['Satima Farmers','Larger Sagana Farmers','Kangema Farmers','Others'];
  for(const [i,category] of categories.entries())await createFarmer(c,{full_name:'CATEGORY LINK TEST '+i,primary_phone:'CATEGORY-LINK-'+i,registered_by:'TEST',category});
  const unassigned=await createFarmer(c,{full_name:'CATEGORY LINK TEST UNASSIGNED',primary_phone:'CATEGORY-LINK-UNASSIGNED',registered_by:'TEST'});
  const query=category=>listFarmers(c,params({scope:'registered',category,q:'CATEGORY LINK TEST'}));
  for(const category of categories){const result=await query(category);assert.equal(result.stats.total,1,category);assert.equal(result.farmers[0].category,category);}
  assert.equal((await query('unassigned')).stats.total,1);
  const {rows:[record]}=await c.query('SELECT updated_at::text AS revision,registration_date::text FROM farmers WHERE id=$1',[unassigned.id]);
  await updateFarmer(c,unassigned.id,{full_name:'CATEGORY LINK TEST UNASSIGNED',primary_phone:'CATEGORY-LINK-UNASSIGNED',registered_by:'TEST',registration_date:record.registration_date,category:'Others',revision:record.revision});
  assert.equal((await query('unassigned')).stats.total,0);
  assert.equal((await query('Others')).stats.total,2);
 }finally{await c.query('ROLLBACK');c.release();}
});
test('pagination traverses more than 200 farmers with accurate filtered counts, ordering and literal search',{skip:process.env.TEST_ISOLATED_DATABASE!=='1'},async()=>{
 const c=await pool.connect();await c.query('BEGIN');try{
 for(let i=0;i<205;i++)await c.query(`INSERT INTO farmers(full_name,primary_phone,registered_by,record_kind,village_area,county,location,registered_business_name,registration_date,status) VALUES($1,$2,'TEST STAFF','registered','ISOLATED VILLAGE','ISOLATED COUNTY','ISOLATED LOCATION','ISOLATED BUSINESS',$3,$4)`,['ISOLATED PAGINATION '+String(i).padStart(3,'0'),'ISOLATED PHONE '+i,i<100?'2026-01-01':'2026-02-01',i===0?'inactive':'pending_verification']);
 const first=await listFarmers(c,params({q:'ISOLATED PAGINATION',sort:'full_name',page_size:'50'}));assert.equal(first.stats.total,205);assert.equal(first.stats.pending,204);assert.equal(first.farmers.length,50);assert.equal(first.pagination.total_pages,5);
 const ids=[];for(let page=1;page<=5;page++){const data=await listFarmers(c,params({q:'ISOLATED PAGINATION',sort:'full_name',page:String(page)}));ids.push(...data.farmers.map(f=>f.id));assert.equal(data.stats.total,205);}assert.equal(new Set(ids).size,205);
 const end=await listFarmers(c,params({q:'ISOLATED PAGINATION',page:'6'}));assert.equal(end.farmers.length,0);assert.equal(end.stats.total,205);
 const desc=await listFarmers(c,params({q:'ISOLATED PAGINATION',sort:'full_name',direction:'desc'}));assert.equal(desc.farmers[0].full_name,'ISOLATED PAGINATION 204');
 assert.equal((await listFarmers(c,params({q:'ISOLATED PAGINATION',status:'inactive'}))).stats.total,1);
 assert.equal((await listFarmers(c,params({q:'ISOLATED PAGINATION',scope:'all'}))).stats.total,205);
 assert.equal((await listFarmers(c,params({q:'ISOLATED BUSINESS',county:'isolated county',location:'isolated location'}))).stats.total,205);
 await c.query("INSERT INTO farmer_data_issues(farmer_id,field_name,description) VALUES($1,'phone','ISOLATED REVIEW')",[first.farmers[0].id]);
 const review=await listFarmers(c,params({q:'ISOLATED PAGINATION',review:'open'}));assert.equal(review.stats.total,1);assert.equal(review.stats.needs_review,1);assert.equal(review.farmers[0].open_issues,1);
 assert.equal((await listFarmers(c,params({q:'ISOLATED PAGINATION',review:'clear'}))).stats.total,204);
 assert.equal((await listFarmers(c,params({q:'1 open',county:'ISOLATED COUNTY'}))).stats.total,1);
 await c.query("INSERT INTO farmers(full_name,primary_phone,registered_by) VALUES('ISOLATED 100%_literal','ISOLATED','TEST')");assert.equal((await listFarmers(c,params({q:'100%_literal'}))).stats.total,1);assert.equal((await listFarmers(c,params({q:'100XQliteral'}))).stats.total,0);
 for(const sort of ['customer_id','registration_date','status']){const data=await listFarmers(c,params({q:'ISOLATED PAGINATION',sort}));assert.equal(data.farmers.length,50);}
 }finally{await c.query('ROLLBACK');c.release();}
});
test('activation requires current evidence and histories/classification stay protected',{skip:process.env.TEST_ISOLATED_DATABASE!=='1'},async()=>{
 const c=await pool.connect();await c.query('BEGIN');
 const fixture={full_name:'ISOLATED EVIDENCE',primary_phone:'ISOLATED PHONE',registered_by:'TEST',registration_date:'2026-01-01',national_id:'ISOLATED ID',kra_pin:'ISOLATED PIN',payment:{mpesa_registered_name:'ISOLATED PAYEE',mpesa_phone_number:'ISOLATED MPESA',verified:true,verified_at:'2026-01-01T00:00:00Z'}};
 const checks=['national_id_verified','kra_pin_verified','primary_phone_verified','mpesa_number_verified','mpesa_registered_name_confirmed','registration_form_complete','consent_obtained'];
 const verification={...Object.fromEntries(checks.map(k=>[k,true])),verified_by:'ISOLATED OFFICER',verified_at:'2026-01-01T00:00:00Z'};
 const consent={consent_version:'ISOLATED',information_accuracy_confirmed:true,data_processing_consent:true,communications_consent:false,consent_given:true,signed_name:'ISOLATED',signature_method:'signature',consent_date:'2026-01-01T00:00:00Z'};
 async function fails(fn){await c.query('SAVEPOINT rejected');try{await assert.rejects(async()=>{await fn();await c.query('SET CONSTRAINTS ALL IMMEDIATE');},e=>['23514','P0001','42501'].includes(e.code));}finally{await c.query('ROLLBACK TO SAVEPOINT rejected');await c.query('SET CONSTRAINTS ALL DEFERRED');}}
 try{
 const f=await createFarmer(c,fixture);await fails(()=>c.query("UPDATE farmers SET status='active' WHERE id=$1",[f.id]));
 const revision=(await c.query('SELECT updated_at::text AS revision FROM farmers WHERE id=$1',[f.id])).rows[0].revision;
 await updateFarmer(c,f.id,{...fixture,status:'active',revision,verification,consent});await c.query('SET CONSTRAINTS ALL IMMEDIATE');await c.query('SET CONSTRAINTS ALL DEFERRED');
 assert.equal((await c.query('SELECT status FROM farmers WHERE id=$1',[f.id])).rows[0].status,'active');
 await fails(()=>c.query("UPDATE farmers SET primary_phone='CHANGED' WHERE id=$1",[f.id]));
 await fails(()=>c.query('UPDATE farmer_payment_profiles SET verified=false,verified_at=NULL WHERE farmer_id=$1',[f.id]));
 await fails(()=>c.query('UPDATE farmer_consents SET withdrawn_at=now() WHERE farmer_id=$1',[f.id]));
 await fails(()=>c.query("INSERT INTO farmer_data_issues(farmer_id,field_name,description,severity) VALUES($1,'id','ISOLATED HIGH','high')",[f.id]));
 await fails(()=>c.query("UPDATE farmers SET record_kind='demo' WHERE id=$1",[f.id]));
 await fails(()=>c.query("UPDATE farmers SET customer_id='SF-F-777777' WHERE id=$1",[f.id]));
 const {rows:[v]}=await c.query('SELECT * FROM farmer_verifications WHERE farmer_id=$1',[f.id]);assert(v.verified_details);await fails(()=>c.query("UPDATE farmer_verifications SET notes='overwrite' WHERE id=$1",[v.id]));
 await c.query("UPDATE farmers SET status='pending_verification' WHERE id=$1",[f.id]);await c.query('SET CONSTRAINTS ALL IMMEDIATE');
 await c.query('UPDATE farmer_payment_profiles SET verified=false,verified_at=NULL WHERE farmer_id=$1',[f.id]);assert.equal((await c.query('SELECT count(*)::int AS n FROM farmer_verifications WHERE farmer_id=$1',[f.id])).rows[0].n,1);
 }finally{await c.query('ROLLBACK');c.release();}
});

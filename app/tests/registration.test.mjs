import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {pool,master,createFarmer,updateFarmer} from '../store.mjs';
after(()=>pool.end());
const fixture={full_name:'FICTIONAL APP TEST',primary_phone:'TEST-PHONE',registration_date:'2026-10-01',registered_by:'TEST',national_id:'APP-ROLLBACK-ID',kra_pin:'APP-ROLLBACK-PIN',contact:{full_name:'TEST KIN',phone_number:'TEST',relationship:'TEST'},payment:{mpesa_registered_name:'TEST PAYEE',mpesa_phone_number:'TEST'}};
test('validation rejects invalid dates and retains raw phone strings',()=>{
 assert.throws(()=>master({...fixture,registration_date:'2026-02-30'}));
 assert.throws(()=>master({...fixture,full_name:''}));
 assert.equal(master({...fixture,primary_phone:'0722 000 000'}).primary_phone,'0722 000 000');
});
test('registration, payment history, optimistic locking, audit and role protections',async()=>{
 const c=await pool.connect();await c.query('BEGIN');
 async function fails(q,code){await c.query('SAVEPOINT fail');try{await assert.rejects(c.query(q),e=>e.code===code);}finally{await c.query('ROLLBACK TO SAVEPOINT fail');}}
 try{
 await c.query("SELECT set_config('app.actor','Integration test',true)");
 const f=await createFarmer(c,fixture);
 assert.match(f.customer_id,/^SF-F-\d{4,}$/);
 const revision=(await c.query('SELECT updated_at::text AS revision FROM farmers WHERE id=$1',[f.id])).rows[0].revision;
 await updateFarmer(c,f.id,{...fixture,revision,full_name:'FICTIONAL UPDATED',contact:{...fixture.contact,full_name:'TEST UPDATED KIN'},payment:{mpesa_registered_name:'TEST PAYEE 2',mpesa_phone_number:'TEST 2'}});
 await assert.rejects(updateFarmer(c,f.id,{...fixture,revision}),e=>e.status===409);
 assert.equal((await c.query('SELECT count(*)::int AS n FROM farmer_payment_profiles WHERE farmer_id=$1',[f.id])).rows[0].n,2);
 assert.equal((await c.query('SELECT count(*)::int AS n FROM farmer_payment_profiles WHERE farmer_id=$1 AND is_active',[f.id])).rows[0].n,1);
 assert.equal((await c.query('SELECT full_name FROM farmer_contacts WHERE farmer_id=$1',[f.id])).rows[0].full_name,'TEST UPDATED KIN');
 const audit=(await c.query('SELECT * FROM farmer_audit_events WHERE farmer_id=$1',[f.id])).rows;
 assert(audit.length>=7);assert(audit.every(a=>a.actor==='Integration test'));assert(audit.some(a=>a.before_record?.full_name==='FICTIONAL APP TEST'));
 await fails("INSERT INTO farmers(full_name,primary_phone,registered_by,national_id) VALUES('TEST','TEST','TEST','APP-ROLLBACK-ID')",'23505');
 await fails(`DELETE FROM farmers WHERE id='${f.id}'`,'42501');
 await fails('UPDATE farmer_audit_events SET actor=\'forged\'','42501');
 await fails('TRUNCATE farmers CASCADE','42501');
 await c.query('INSERT INTO farmer_consents(farmer_id,consent_version,signed_name,signature_method,consent_date) VALUES($1,$2,$3,$4,now())',[f.id,'TEST','TEST','signature']);
 await fails(`INSERT INTO farmer_consents(farmer_id,consent_version,consent_given,signed_name,signature_method,consent_date) VALUES('${f.id}','TEST',true,'TEST','signature',now())`,'23514');
 const {rows:[issue]}=await c.query('INSERT INTO farmer_data_issues(farmer_id,field_name,description) VALUES($1,$2,$3) RETURNING id',[f.id,'TEST','TEST']);
 await fails(`UPDATE farmer_data_issues SET status='resolved',resolved_at=now() WHERE id='${issue.id}'`,'23514');
 await c.query("UPDATE farmer_data_issues SET status='resolved',resolved_at=now(),resolution_note='TEST correction confirmed' WHERE id=$1",[issue.id]);
 assert.equal((await c.query('SELECT status FROM farmer_data_issues WHERE id=$1',[issue.id])).rows[0].status,'resolved');
 }finally{await c.query('ROLLBACK');c.release();}
});
test('HTTP requires login and same-origin writes; sessions, search and profile evidence work',async()=>{
 const base='http://127.0.0.1:'+process.env.CMS_PORT;
 assert.equal((await fetch(base+'/health')).status,200);
 for(const path of ['/customers','/distributors']){
  const page=await fetch(base+path);
  assert.equal(page.status,200);
  assert.match(await page.text(),/id="stakeholder-content"/);
 }
 assert.equal((await fetch(base+'/api/farmers')).status,401);
 assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:process.env.CMS_PASSWORD})})).status,401);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:process.env.CMS_PASSWORD})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert(login.headers.get('set-cookie').includes('HttpOnly'));
 const headers={Cookie:cookie,Origin:base,'Content-Type':'application/json'};
 const list=await (await fetch(base+'/api/farmers?scope=all',{headers})).json();
 assert(Array.isArray(list.farmers));
 if(list.farmers.length){
 const f=await (await fetch(base+'/api/farmers/'+list.farmers[0].id,{headers})).json();
 assert(Array.isArray(f.sources));assert(Array.isArray(f.issues));assert(Array.isArray(f.consents));
 assert.equal((await fetch(base+'/api/farmers/'+f.id,{method:'PUT',headers,body:JSON.stringify({...f,revision:'stale'})})).status,409);
 }
 assert.equal((await fetch(base+'/api/farmers',{method:'POST',headers,body:JSON.stringify({...fixture,primary_phone:''})})).status,400);
 assert.equal((await fetch(base+'/api/does-not-exist',{headers})).status,404);
 const hostile=await fetch(base+'/api/farmers',{method:'POST',headers:{...headers,Origin:'https://example.org'},body:'{}'});assert.equal(hostile.status,403);
 assert.equal((await fetch(base+'/api/logout',{method:'POST',headers,body:'{}'})).status,200);
 assert.equal((await fetch(base+'/api/farmers',{headers})).status,401);
});
test('full profile edits save unknown dates, tri-state evidence and cleaning notes atomically',async()=>{
 const c=await pool.connect();await c.query('BEGIN');
 const revision=async id=>(await c.query('SELECT updated_at::text AS revision FROM farmers WHERE id=$1',[id])).rows[0].revision;
 try{
 const f=await createFarmer(c,{...fixture,registration_date:null});
 assert.equal(f.registration_date,null);
 const {rows:[issue]}=await c.query("INSERT INTO farmer_data_issues(farmer_id,field_name,description) VALUES($1,'phone','Confirm digits') RETURNING *,updated_at::text AS revision",[f.id]);
 const verification={previous_id:null,national_id_verified:true,kra_pin_verified:false,primary_phone_verified:null,mpesa_number_verified:true,mpesa_registered_name_confirmed:true,registration_form_complete:false,consent_obtained:null,verified_by:'TEST OFFICER',verified_at:'2026-10-02T12:00:00+03:00',notes:'Test evidence'};
 const consent={previous_id:null,consent_version:'TEST',information_accuracy_confirmed:true,data_processing_consent:true,communications_consent:false,consent_given:true,signed_name:'TEST',signature_method:'signature',consent_date:'2026-10-01T00:00:00+03:00'};
 const edit={...fixture,registration_date:null,revision:await revision(f.id),verification,consent,payment:{...fixture.payment,verified:true,verified_at:'2026-10-02T12:00:00+03:00'},issues:[{...issue,description:'Confirmed digits',status:'resolved',resolution_note:'Confirmed by farmer'}]};
 await updateFarmer(c,f.id,edit);
 const {rows:[v]}=await c.query('SELECT * FROM farmer_verifications WHERE farmer_id=$1',[f.id]);
 assert.equal(v.kra_pin_verified,false);assert.equal(v.primary_phone_verified,null);assert.equal(v.national_id_verified,true);
 assert.equal((await c.query('SELECT registration_date FROM farmers WHERE id=$1',[f.id])).rows[0].registration_date,null);
 assert.equal((await c.query('SELECT verified FROM farmer_payment_profiles WHERE farmer_id=$1 AND is_active',[f.id])).rows[0].verified,true);
 assert.equal((await c.query('SELECT status,description FROM farmer_data_issues WHERE id=$1',[issue.id])).rows[0].status,'resolved');
 const {rows:[cons]}=await c.query('SELECT * FROM farmer_consents WHERE farmer_id=$1',[f.id]);assert.equal(cons.communications_consent,false);
 await updateFarmer(c,f.id,{...fixture,revision:await revision(f.id),verification:{...verification,previous_id:v.id,kra_pin_verified:true}});
 assert.equal((await c.query('SELECT count(*)::int AS n FROM farmer_verifications WHERE farmer_id=$1',[f.id])).rows[0].n,2);
 assert.equal((await c.query('SELECT kra_pin_verified FROM farmer_verifications WHERE id=$1',[v.id])).rows[0].kra_pin_verified,false);
 await c.query('SAVEPOINT stale');
 await assert.rejects(updateFarmer(c,f.id,{...edit,revision:await revision(f.id)}),e=>e.status===409);
 await c.query('ROLLBACK TO SAVEPOINT stale');
 const before=await revision(f.id);
 await c.query('SAVEPOINT note');
 await assert.rejects(updateFarmer(c,f.id,{...fixture,revision:before,issues:[{...issue,status:'resolved',resolution_note:''}]}),e=>e.status===400);
 await c.query('ROLLBACK TO SAVEPOINT note');assert.equal(await revision(f.id),before);
 }finally{await c.query('ROLLBACK');c.release();}
});

import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {directoryQuery,listFarmers} from '../directory.mjs';
import {pool,createFarmer,updateFarmer} from '../store.mjs';
after(()=>pool.end());
const params=o=>new URLSearchParams(o);
test('directory validates structured filters and keeps free text parameterized',()=>{
 const query=directoryQuery(params({q:'100%_\\literal',sort:'customer_id',direction:'asc'}));assert(query.sql.includes('::numeric asc'));assert(query.values.includes('%100\\%\\_\\\\literal%'));assert(!query.sql.includes('literal'));assert.equal(query.pageSize,50);
 for(const o of [{page:'0'},{page:'1.5'},{page_size:'501'},{sort:'id; DROP TABLE farmers'},{direction:'other'},{scope:'unknown'},{status:'verified'},{review:'unknown'},{q:'x'.repeat(101)}])assert.throws(()=>directoryQuery(params(o)),e=>e.status===400);
});
test('pagination traverses more than 200 farmers with accurate filtered counts, ordering and literal search',{skip:process.env.TEST_ISOLATED_DATABASE!=='1'},async()=>{
 const c=await pool.connect();await c.query('BEGIN');try{
 for(let i=0;i<205;i++)await c.query(`INSERT INTO farmers(full_name,primary_phone,registered_by,record_kind,village_area,county,location,registered_business_name,registration_date,status) VALUES($1,$2,'TEST STAFF','registered','ISOLATED VILLAGE','ISOLATED COUNTY','ISOLATED LOCATION','ISOLATED BUSINESS',$3,$4)`,['ISOLATED PAGINATION '+String(i).padStart(3,'0'),'ISOLATED PHONE '+i,i<100?'2026-01-01':'2026-02-01',i===0?'inactive':'pending_verification']);
 const first=await listFarmers(c,params({q:'ISOLATED PAGINATION',sort:'full_name',page_size:'50'}));assert.equal(first.stats.total,205);assert.equal(first.stats.pending,204);assert.equal(first.farmers.length,50);assert.equal(first.pagination.total_pages,5);
 const ids=[];for(let page=1;page<=5;page++){const data=await listFarmers(c,params({q:'ISOLATED PAGINATION',sort:'full_name',page:String(page)}));ids.push(...data.farmers.map(f=>f.id));assert.equal(data.stats.total,205);}assert.equal(new Set(ids).size,205);
 const end=await listFarmers(c,params({q:'ISOLATED PAGINATION',page:'6'}));assert.equal(end.farmers.length,0);assert.equal(end.stats.total,205);
 const desc=await listFarmers(c,params({q:'ISOLATED PAGINATION',sort:'full_name',direction:'desc'}));assert.equal(desc.farmers[0].full_name,'ISOLATED PAGINATION 204');
 assert.equal((await listFarmers(c,params({q:'ISOLATED PAGINATION',status:'inactive'}))).stats.total,1);
 assert.equal((await listFarmers(c,params({q:'ISOLATED PAGINATION',scope:'demo'}))).stats.total,0);
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

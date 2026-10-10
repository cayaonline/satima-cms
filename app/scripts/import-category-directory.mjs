// Import a privately reviewed name/category plan. Never commit the plan or source PDF.
import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {farmerCategories} from '../store.mjs';
const [planPath,pdfPath,resultPath,mode]=process.argv.slice(2);
if(!planPath||!pdfPath)throw new Error('Supply a private reviewed plan and its PDF.');
const plan=JSON.parse(await readFile(planPath,'utf8'));
const sourceHash=createHash('sha256').update(await readFile(pdfPath)).digest('hex');
assert.equal(plan.document_sha256,sourceHash,'PDF changed since transcription');
assert(Array.isArray(plan.records)&&plan.records.length>0,'No directory entries');
const keys=new Set();
for(const r of plan.records){
 assert(farmerCategories.includes(r.category),'Invalid category');
 assert(typeof r.name==='string'&&r.name.trim(),'Missing source name');
 assert(typeof r.phone==='string'&&r.phone.trim(),'Missing source phone');
 assert(['matched','not_registered','review_required'].includes(r.status),'Invalid match decision');
 assert(Number.isInteger(r.page)&&r.page>0&&Number.isInteger(r.index)&&r.index>0,'Invalid page or row');
 const key=r.page+':'+r.index;assert(!keys.has(key),'Duplicate source row');keys.add(key);
 if(r.status==='matched')assert(r.farmer_id,'Matched row needs an existing farmer');
 else assert(!r.farmer_id,'Unregistered row cannot claim an existing farmer');
}
if(mode!=='apply'){console.log(`Reviewed plan valid: ${plan.records.length} directory listings; no changes made.`);process.exit(0);}
const admin=process.env.ADMIN_DATABASE_URL;if(!admin)throw new Error('Owner database connection required.');
const db=new pg.Client({connectionString:admin,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=60000'});
await db.connect();let report;
try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(728410023)');
 await db.query("SELECT set_config('app.actor','April directory import',true)");
 report={sourceRows:plan.records.length,matched:0,addedNotRegistered:0,addedReviewRequired:0,skipped:0,categories:Object.fromEntries(farmerCategories.map(c=>[c,0]))};
 for(const r of plan.records){
  const previous=await db.query('SELECT farmer_id FROM farmer_directory_sources WHERE document_sha256=$1 AND page_number=$2 AND row_number=$3',[sourceHash,r.page,r.index]);
  if(previous.rowCount){report.skipped++;continue;}
  let farmerId;
  if(r.status==='matched'){
   const target=(await db.query('SELECT id,record_kind,registration_status,category,customer_id,primary_phone FROM farmers WHERE id=$1 FOR UPDATE',[r.farmer_id])).rows[0];
   assert(target&&target.record_kind==='registered'&&target.registration_status==='registered'&&target.customer_id===r.customer_id,'Match target changed');
   const normalize=s=>String(s||'').replace(/\D/g,'').replace(/^254/,'0');
   assert(normalize(target.primary_phone)===normalize(r.phone),'Matched phone changed');
   assert(!target.category||target.category===r.category,'Existing category conflicts with source');
   if(!target.category)await db.query('UPDATE farmers SET category=$2 WHERE id=$1',[target.id,r.category]);
   farmerId=target.id;report.matched++;
  }else{
   const duplicate=await db.query('SELECT 1 FROM farmers WHERE lower(full_name)=lower($1) AND primary_phone=$2',[r.name,r.phone]);
   assert(!duplicate.rowCount,'Name and phone already in directory');
   // A review row may intentionally share a phone with a different existing name.
   if(r.status==='not_registered')assert(!(await db.query('SELECT 1 FROM farmers WHERE primary_phone=$1',[r.phone])).rowCount,'Phone match now requires review');
   const added=(await db.query(`INSERT INTO farmers(customer_id,full_name,registered_by,registration_date,status,record_kind,registration_status,category)
    VALUES(NULL,$1,NULL,NULL,'pending_verification','registered',$2,$3) RETURNING id`,[r.name,r.status,r.category])).rows[0];
   farmerId=added.id;
   if(r.status==='review_required'){
    await db.query('INSERT INTO farmer_data_issues(farmer_id,field_name,description,severity) VALUES($1,$2,$3,$4)',[farmerId,'registration_match',r.review_reason||'Confirm this source identity before registration.','review']);
    report.addedReviewRequired++;
   }else report.addedNotRegistered++;
  }
  await db.query(`INSERT INTO farmer_directory_sources(farmer_id,document_name,document_sha256,page_number,row_number,source_name,source_category,match_result,review_reason)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[farmerId,plan.document_name,sourceHash,r.page,r.index,r.name,r.category,r.status,r.review_reason||null]);
  report.categories[r.category]++;
 }
 await db.query('COMMIT');
 if(resultPath)await writeFile(resultPath,JSON.stringify({...report,document_sha256:sourceHash,completed_at:new Date().toISOString()},null,2),{mode:0o600});
 console.log(JSON.stringify(report));
}catch(e){await db.query('ROLLBACK');console.error('Directory import rolled back:',e.code||e.message);process.exitCode=1;}
finally{await db.end();}

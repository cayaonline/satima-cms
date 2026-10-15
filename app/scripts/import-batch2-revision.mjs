// Private, reviewed revision import. Keep the PDF and identifying manifest out of Git.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import assert from 'node:assert/strict';
import {importArchiveBatch} from '../registration-archive.mjs';

const [manifestPath,mode='check']=process.argv.slice(2);
if(!manifestPath||!['check','apply'].includes(mode))throw new Error('Pass a private revision manifest and optional apply mode.');
const plan=JSON.parse(await readFile(manifestPath,'utf8'));
const bytes=await readFile(plan.document_path);
const checksum=createHash('sha256').update(bytes).digest('hex');
assert.equal(checksum,plan.document_sha256,'Updated PDF differs from reviewed source');
const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
assert.equal(pdf.getPageCount(),26,'Updated Batch 2 must have 26 pages');
assert.match(plan.previous_sha256,/^[a-f0-9]{64}$/);
assert.equal(plan.previous_batch_id,'BATCH-002');
assert.equal(plan.batch_id,'BATCH-002-R2');
assert.equal(plan.previous_holder.customer_id,'SF-F-0001');
assert.equal(plan.form.page_start,1);
assert.equal(plan.form.page_end,2);
assert.equal(plan.form.full_name,'JUDY NYAWIRA GIKARU');
assert.equal(plan.form.registered_business_name,'SATIMA FARMHOUSE LIMITED');
assert.equal(plan.form.gender,'female');
assert.equal(plan.form.gender_source,'registration_document');
assert.equal(plan.form.preferred_language,'English');
assert.match(plan.form.date_of_birth,/^\d{4}-\d{2}-\d{2}$/);
assert.match(plan.form.registration_date,/^\d{4}-\d{2}-\d{2}$/);
assert(Array.isArray(plan.form.issues)&&plan.form.issues.length,'Unconfirmed source details require review notes');
for(const issue of plan.form.issues)assert(issue.field&&issue.description);
const summary={source_pages:26,forms:13,previous_forms:12,new_farmers:1,reassigned_ids:1};
if(mode==='check'){console.log(JSON.stringify({...summary,applied:false}));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw new Error('Owner database connection required.');

const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=120000'});
const clean=value=>value==null||value===''?null:String(value).trim();
const phone=value=>String(value||'').replace(/\D/g,'').slice(-9);
let phase='connect';
await db.connect();
try{
 phase='lock and validate';
 await db.query('BEGIN');
 await db.query('SELECT pg_advisory_xact_lock(728410023)');
 await db.query("SELECT set_config('app.actor','Reviewed Batch 2 revision and Farmer ID reassignment',true)");
 const {rows:[already]}=await db.query('SELECT sha256,supersedes_batch_id FROM registration_archive_batches WHERE id=$1',[plan.batch_id]);
 if(already){
  assert.equal(already.sha256,checksum,'Revision ID belongs to a different PDF');
  assert.equal(already.supersedes_batch_id,plan.previous_batch_id,'Revision lineage differs');
  const {rows:[state]}=await db.query(`SELECT
   (SELECT count(*)::int FROM registration_archive_entries WHERE batch_id=$1) AS entries,
   (SELECT count(*)::int FROM farmer_registration_sources WHERE document_sha256=$2) AS sources,
   (SELECT count(*)::int FROM farmers WHERE customer_id='SF-F-0001' AND national_id=$3 AND registered_business_name=$4) AS farmer,
   (SELECT count(*)::int FROM farmers WHERE id=$5 AND customer_id<>'SF-F-0001') AS prior_holder`,
   [plan.batch_id,checksum,plan.form.national_id,plan.form.registered_business_name,plan.previous_holder.id]);
  assert.deepEqual(state,{entries:13,sources:13,farmer:1,prior_holder:1},'Revision is incomplete');
  await db.query('ROLLBACK');console.log(JSON.stringify({...summary,already_applied:true}));process.exit(0);
 }
 const {rows:[oldBatch]}=await db.query('SELECT sha256,page_count,expected_farmer_count FROM registration_archive_batches WHERE id=$1 FOR UPDATE',[plan.previous_batch_id]);
 assert(oldBatch&&oldBatch.sha256===plan.previous_sha256&&oldBatch.page_count===24&&oldBatch.expected_farmer_count===12,'Previous Batch 2 changed');
 const {rows:oldEntries}=await db.query(`SELECT e.page_start,e.page_end,e.farmer_id,e.verification_status,s.raw_transcription
  FROM registration_archive_entries e JOIN farmer_registration_sources s
   ON s.farmer_id=e.farmer_id AND s.document_sha256=$2 AND s.first_page=e.page_start AND s.last_page=e.page_end
  WHERE e.batch_id=$1 ORDER BY e.page_start FOR UPDATE OF e`,[plan.previous_batch_id,plan.previous_sha256]);
 assert.equal(oldEntries.length,12,'Previous forms or provenance are incomplete');
 for(let i=0;i<12;i++)assert(oldEntries[i].page_start===i*2+1&&oldEntries[i].page_end===i*2+2,'Previous form order changed');
 const {rows:[successor]}=await db.query('SELECT id FROM registration_archive_batches WHERE supersedes_batch_id=$1',[plan.previous_batch_id]);
 assert(!successor,'Another revision already supersedes Batch 2');
 const {rows:[holder]}=await db.query(`SELECT id,customer_id,full_name,primary_phone,national_id,registration_status,record_kind
  FROM farmers WHERE customer_id='SF-F-0001' FOR UPDATE`);
 assert(holder&&Object.entries(plan.previous_holder).every(([key,value])=>holder[key]===value),'Farmer 0001 changed since review');
 const {rows:conflicts}=await db.query(`SELECT id FROM farmers WHERE id<>$1 AND
  (national_id=$2 OR kra_pin=$3 OR lower(full_name)=lower($4) OR
   right(regexp_replace(primary_phone,'[^0-9]','','g'),9)=$5) LIMIT 2 FOR UPDATE`,
  [holder.id,plan.form.national_id,plan.form.kra_pin,plan.form.full_name,phone(plan.form.primary_phone)]);
 assert.equal(conflicts.length,0,'Registration identifiers may match an existing farmer');
 const {rows:[next]}=await db.query('SELECT next_farmer_customer_id() AS customer_id');
 assert.match(next.customer_id,/^SF-F-[0-9]{4,}$/);
 assert.notEqual(next.customer_id,'SF-F-0001');
 const {rows:[taken]}=await db.query('SELECT 1 FROM farmers WHERE customer_id=$1',[next.customer_id]);
 assert(!taken,'Generated Farmer ID is already occupied');
 phase='disable identity trigger';
 // The identity trigger is disabled only inside this locked owner transaction.
 // The audit trigger remains active and records both the old and new IDs.
 await db.query('ALTER TABLE farmers DISABLE TRIGGER farmers_identity');
 phase='update existing Farmer ID';
 await db.query('UPDATE farmers SET customer_id=$2 WHERE id=$1',[holder.id,next.customer_id]);
 phase='restore identity trigger';
 await db.query('SET CONSTRAINTS ALL IMMEDIATE');
 await db.query('ALTER TABLE farmers ENABLE TRIGGER farmers_identity');
 phase='insert updated registration';
 const f=plan.form;
 const {rows:[created]}=await db.query(`INSERT INTO farmers(customer_id,record_kind,registration_status,status,full_name,registered_business_name,
  national_id,kra_pin,primary_phone,physical_address,village_area,sub_location,location,sub_county,county,
  registration_date,registered_by,gender,gender_source,gender_verified_at,date_of_birth,preferred_language,category)
  VALUES('SF-F-0001','registered','registered','pending_verification',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),$16,$17,$18)
  RETURNING id`,[f.full_name,f.registered_business_name,f.national_id,f.kra_pin,f.primary_phone,f.physical_address,
  f.village_area,f.sub_location,f.location,f.sub_county,f.county,f.registration_date,f.registered_by,f.gender,f.gender_source,
  f.date_of_birth,f.preferred_language,clean(f.category)]);
 const farmerId=created.id;
 if(f.next_of_kin?.name&&f.next_of_kin.phone&&f.next_of_kin.relationship)
  await db.query(`INSERT INTO farmer_contacts(farmer_id,full_name,phone_number,relationship,is_primary_alternative)
   VALUES($1,$2,$3,$4,true)`,[farmerId,f.next_of_kin.name,f.next_of_kin.phone,f.next_of_kin.relationship]);
 if(f.mpesa?.name&&f.mpesa.phone)
  await db.query(`INSERT INTO farmer_payment_profiles(farmer_id,mpesa_registered_name,mpesa_phone_number)
   VALUES($1,$2,$3)`,[farmerId,f.mpesa.name,f.mpesa.phone]);
 if(f.consent?.date&&f.consent.signed)
  await db.query(`INSERT INTO farmer_consents(farmer_id,consent_version,information_accuracy_confirmed,data_processing_consent,
   communications_consent,consent_given,signed_name,signature_method,consent_date)
   VALUES($1,$2,$3,$4,$5,true,$6,'signature',$7)`,[farmerId,'paper-unversioned-'+checksum.slice(0,12),
   f.consent.accuracy===true,f.consent.processing===true,f.consent.communications===true,f.consent.name||f.full_name,f.consent.date+'T12:00:00+03:00']);
 for(const issue of f.issues)await db.query("INSERT INTO farmer_data_issues(farmer_id,field_name,description,severity) VALUES($1,$2,$3,'review')",[farmerId,issue.field,issue.description]);
 const entries=[{page_start:1,page_end:2,farmer_id:farmerId,verification_status:'matched'}];
 const sources=[{farmer_id:farmerId,first_page:1,last_page:2,raw_transcription:JSON.stringify(f)}];
 for(const old of oldEntries){
  const transcription=typeof old.raw_transcription==='string'?JSON.parse(old.raw_transcription):structuredClone(old.raw_transcription);
  transcription.page_start=old.page_start+2;transcription.page_end=old.page_end+2;
  entries.push({page_start:old.page_start+2,page_end:old.page_end+2,farmer_id:old.farmer_id,verification_status:old.verification_status});
  sources.push({farmer_id:old.farmer_id,first_page:old.page_start+2,last_page:old.page_end+2,raw_transcription:JSON.stringify(transcription)});
 }
 assert.equal(entries.length,13);
 phase='archive revised master';
 await importArchiveBatch({id:plan.batch_id,name:'Original Farmer Registration — Batch 2 (Updated)',filename:plan.original_filename,
  expected:13,supersedesBatchId:plan.previous_batch_id},{bytes,pageCount:26,checksum},entries,db);
 for(const source of sources)await db.query(`INSERT INTO farmer_registration_sources(farmer_id,document_name,document_sha256,first_page,last_page,raw_transcription)
  VALUES($1,$2,$3,$4,$5,$6)`,[source.farmer_id,plan.original_filename,checksum,source.first_page,source.last_page,source.raw_transcription]);
 await db.query('COMMIT');console.log(JSON.stringify({...summary,previous_id_reassigned_to:next.customer_id,applied:true}));
}catch(error){await db.query('ROLLBACK');console.error('Batch 2 revision rolled back at',phase+':',error.code||error.name);process.exitCode=1;}
finally{await db.end();}

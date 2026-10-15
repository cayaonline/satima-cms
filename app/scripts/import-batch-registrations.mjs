// Private, reviewed two-page paper-form import. The PDF and manifest never enter Git.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import assert from 'node:assert/strict';
import {importArchiveBatch} from '../registration-archive.mjs';

const [manifestPath,mode='check']=process.argv.slice(2);
if(!manifestPath)throw new Error('Provide a private Batch 2 manifest.');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const bytes=await readFile(manifest.document_path);
const checksum=createHash('sha256').update(bytes).digest('hex');
assert.equal(checksum,manifest.document_sha256,'Batch PDF changed since review');
const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
assert.equal(pdf.getPageCount(),24,'Batch 2 must contain 24 pages');
assert.equal(manifest.forms?.length,12,'Batch 2 must contain 12 forms');
const byPage=new Set(),byFarmer=new Set(),byPhone=new Set();
for(const form of manifest.forms){
 assert(Number.isInteger(form.page_start)&&form.page_start%2===1&&form.page_end===form.page_start+1,'Each registration needs its two source pages');
 assert(!byPage.has(form.page_start),'Repeated page pair');byPage.add(form.page_start);
 assert(typeof form.full_name==='string'&&form.full_name.trim()&&/^0[0-9]{9}$/.test(form.primary_phone),'Invalid reviewed identity');
 assert(!byPhone.has(form.primary_phone),'Repeated phone');byPhone.add(form.primary_phone);
 assert(['promote','create','hold'].includes(form.action),'Unknown import decision');
 if(form.action!=='create'){
  assert(form.existing&&form.existing.id&&!byFarmer.has(form.existing.id),'Existing farmer snapshot required');
  byFarmer.add(form.existing.id);
 }else assert(!form.existing,'New farmer cannot claim an existing ID');
 assert(form.action!=='hold'||form.issues?.length,'Held form needs a review reason');
}
assert.equal(byPage.size,12,'A source page pair is missing');
for(let page=1;page<=23;page+=2)assert(byPage.has(page),'A source page pair is missing');
const summary={forms:12,promotions:manifest.forms.filter(f=>f.action==='promote').length,new_farmers:manifest.forms.filter(f=>f.action==='create').length,held_for_review:manifest.forms.filter(f=>f.action==='hold').length};
if(mode!=='apply'){console.log(JSON.stringify({...summary,applied:false}));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw new Error('Owner database connection required.');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=120000'});
const phone=value=>String(value||'').replace(/\D/g,'').slice(-9);
const clean=value=>value==null||value===''?null:String(value).trim();
await db.connect();
try{
 await db.query('BEGIN');
 await db.query('SELECT pg_advisory_xact_lock(728410023)');
 await db.query("SELECT set_config('app.actor','Batch 2 paper registration import',true)");
 const {rows:[prior]}=await db.query('SELECT id,sha256 FROM registration_archive_batches WHERE id=$1',['BATCH-002']);
 if(prior){
  assert.equal(prior.sha256,checksum,'Batch ID belongs to a different PDF');
  const {rows:[state]}=await db.query(`SELECT
   (SELECT count(*)::int FROM registration_archive_entries WHERE batch_id='BATCH-002') AS entries,
   (SELECT count(*)::int FROM farmer_registration_sources WHERE document_sha256=$1) AS sources`,[checksum]);
  assert.equal(state.entries,12,'Batch archive import is incomplete');
  assert.equal(state.sources,12,'Batch registration provenance is incomplete');
  await db.query('ROLLBACK');console.log(JSON.stringify({...summary,already_applied:true}));process.exit(0);
 }
 const entries=[];
 for(const form of manifest.forms){
  const {rows:duplicates}=await db.query(`SELECT id,full_name,customer_id,registration_status FROM farmers
   WHERE record_kind='registered' AND
    (right(regexp_replace(coalesce(primary_phone,''),'[^0-9]','','g'),9)=$1
    OR ($2::text IS NOT NULL AND national_id=$2)
    OR ($3::text IS NOT NULL AND kra_pin=$3)) FOR UPDATE`,[phone(form.primary_phone),clean(form.national_id),clean(form.kra_pin)]);
  let farmerId;
  if(form.action==='create'){
   assert.equal(duplicates.length,0,'Possible duplicate farmer; no new record created');
   const byName=await db.query("SELECT id FROM farmers WHERE lower(regexp_replace(full_name,'[^a-zA-Z]','','g'))=lower(regexp_replace($1,'[^a-zA-Z]','','g')) LIMIT 1",[form.full_name]);
   assert.equal(byName.rowCount,0,'Name matches another farmer; review before creating');
   const {rows:[created]}=await db.query(`INSERT INTO farmers(customer_id,registration_status,record_kind,status,full_name,national_id,primary_phone,kra_pin,
    registered_business_name,physical_address,village_area,sub_location,location,sub_county,county,registration_date,registered_by,category)
    VALUES(next_farmer_customer_id(),'registered','registered','pending_verification',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING id`,[form.full_name,clean(form.national_id),form.primary_phone,clean(form.kra_pin),clean(form.registered_business_name),clean(form.physical_address),clean(form.village_area),clean(form.sub_location),clean(form.location),clean(form.sub_county),clean(form.county),form.registration_date||null,clean(form.registered_by),null]);
   farmerId=created.id;
  }else{
   const {rows:[existing]}=await db.query("SELECT id,full_name,primary_phone,registration_status,customer_id,national_id,kra_pin FROM farmers WHERE id=$1 AND record_kind='registered' FOR UPDATE",[form.existing.id]);
   assert(existing&&existing.full_name===form.existing.full_name&&existing.primary_phone===form.existing.primary_phone&&existing.registration_status===form.existing.registration_status&&existing.customer_id===form.existing.customer_id,'Farmer changed since matching review');
   assert.equal(phone(existing.primary_phone),phone(form.primary_phone),'Source phone no longer matches farmer');
   assert(duplicates.every(item=>item.id===existing.id),'An identifier matches a different farmer');
   assert(!existing.national_id||existing.national_id===clean(form.national_id),'National ID conflicts with existing record');
   assert(!existing.kra_pin||existing.kra_pin===clean(form.kra_pin),'KRA PIN conflicts with existing record');
   assert(existing.registration_status!=='registered','Batch form already belongs to a registered farmer');
   farmerId=existing.id;
   if(form.action==='promote'){
    await db.query(`UPDATE farmers SET customer_id=next_farmer_customer_id(),registration_status='registered',
     full_name=$2,national_id=coalesce(national_id,$3),kra_pin=coalesce(kra_pin,$4),
     registered_business_name=coalesce(registered_business_name,$5),physical_address=coalesce(physical_address,$6),
     village_area=coalesce(village_area,$7),sub_location=coalesce(sub_location,$8),location=coalesce(location,$9),
     sub_county=coalesce(sub_county,$10),county=coalesce(county,$11),registration_date=$12,registered_by=$13
     WHERE id=$1`,[farmerId,form.full_name,clean(form.national_id),clean(form.kra_pin),clean(form.registered_business_name),clean(form.physical_address),clean(form.village_area),clean(form.sub_location),clean(form.location),clean(form.sub_county),clean(form.county),form.registration_date||null,clean(form.registered_by)]);
   }
  }
  if(form.action!=='hold'){
   if(form.next_of_kin?.name&&form.next_of_kin.phone&&form.next_of_kin.relationship){
    const priorContact=await db.query('SELECT 1 FROM farmer_contacts WHERE farmer_id=$1 AND is_primary_alternative',[farmerId]);
    if(!priorContact.rowCount)await db.query("INSERT INTO farmer_contacts(farmer_id,full_name,phone_number,relationship,is_primary_alternative) VALUES($1,$2,$3,$4,true)",[farmerId,form.next_of_kin.name,form.next_of_kin.phone,form.next_of_kin.relationship]);
   }
   if(form.mpesa?.name&&form.mpesa.phone){
    const priorPayment=await db.query('SELECT 1 FROM farmer_payment_profiles WHERE farmer_id=$1 AND is_active',[farmerId]);
    if(!priorPayment.rowCount)await db.query('INSERT INTO farmer_payment_profiles(farmer_id,mpesa_registered_name,mpesa_phone_number) VALUES($1,$2,$3)',[farmerId,form.mpesa.name,form.mpesa.phone]);
   }
   if(form.consent?.date){
    const confirmed=form.consent.accuracy===true&&form.consent.processing===true&&form.consent.signed===true;
    await db.query(`INSERT INTO farmer_consents(farmer_id,consent_version,information_accuracy_confirmed,data_processing_consent,
     communications_consent,consent_given,signed_name,signature_method,consent_date)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[farmerId,'paper-unversioned-'+checksum.slice(0,12),form.consent.accuracy??null,form.consent.processing??null,form.consent.communications??null,confirmed?true:null,form.consent.signed?form.consent.name||form.full_name:null,form.consent.signed?'signature':null,form.consent.date+'T12:00:00+03:00']);
   }
  }
  await db.query(`INSERT INTO farmer_registration_sources(farmer_id,document_name,document_sha256,first_page,last_page,raw_transcription)
    VALUES($1,$2,$3,$4,$5,$6)`,[farmerId,manifest.original_filename,checksum,form.page_start,form.page_end,JSON.stringify(form)]);
  for(const issue of form.issues||[])await db.query("INSERT INTO farmer_data_issues(farmer_id,field_name,description,severity) VALUES($1,$2,$3,'review')",[farmerId,issue.field,issue.description]);
  entries.push({page_start:form.page_start,page_end:form.page_end,farmer_id:farmerId,verification_status:form.action==='hold'?'needs_review':'matched'});
 }
 await importArchiveBatch({id:'BATCH-002',name:'Original Farmer Registration — Batch 2',filename:manifest.original_filename,expected:12},{bytes,pageCount:24,checksum},entries,db);
 await db.query('COMMIT');console.log(JSON.stringify({...summary,archive_entries:entries.length,applied:true}));
}catch(error){await db.query('ROLLBACK');console.error('Batch 2 import rolled back:',error.code||error.name);process.exitCode=1;}
finally{await db.end();}

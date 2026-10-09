// Input is a PRIVATE JSON transcription file, never a source-controlled fixture.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pool,transaction,createFarmer} from '../store.mjs';
try{
 const data=JSON.parse(await readFile(process.argv[2],'utf8'));
 const actual=createHash('sha256').update(await readFile(data.document_path)).digest('hex');
 if(actual!==data.document_sha256)throw new Error('Source hash does not match.');
 let inserted=0,skipped=0;
 await transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(728410023)');
  for(const record of data.records){
   const exists=await c.query('SELECT 1 FROM farmer_registration_sources WHERE document_sha256=$1 AND first_page=$2',[actual,record.first_page]);
   if(exists.rowCount){skipped++;continue;}
   const f=await createFarmer(c,{...record.farmer,status:'pending_verification'});
   await c.query('INSERT INTO farmer_registration_sources(farmer_id,document_name,document_sha256,first_page,last_page,raw_transcription) VALUES($1,$2,$3,$4,$5,$6)',[f.id,data.document_name,actual,record.first_page,record.last_page,JSON.stringify(record.raw)]);
   await c.query(`INSERT INTO farmer_consents(farmer_id,consent_version,information_accuracy_confirmed,data_processing_consent,communications_consent,consent_given,signed_name,signature_method,consent_date)
   VALUES($1,$2,NULL,NULL,NULL,NULL,$3,'signature',$4)`,[f.id,'paper-unversioned-'+actual.slice(0,12),record.consent.signed_name,record.consent.date+'T00:00:00+03:00']);
   const checks=['national_id_verified','kra_pin_verified','primary_phone_verified','mpesa_number_verified','mpesa_registered_name_confirmed','registration_form_complete','consent_obtained'];
   await c.query(`INSERT INTO farmer_verifications(farmer_id,${checks.join(',')},verified_by,verified_at,notes) VALUES(${Array.from({length:11},(_,i)=>'$'+(i+1)).join(',')})`,[f.id,...checks.map(k=>record.verification[k]??null),record.verification.by,record.verification.date+'T00:00:00+03:00',record.verification.notes]);
   for(const i of record.issues)await c.query('INSERT INTO farmer_data_issues(farmer_id,field_name,description,severity) VALUES($1,$2,$3,$4)',[f.id,i.field,i.description,i.severity||'review']);
   inserted++;
  }
 },'Paper form import');
 console.log(`Imported ${inserted} registrations; skipped ${skipped} previously imported forms. All new records pending verification.`);
}catch(e){console.error('Import failed; transaction rolled back.',e.code||e.name);process.exitCode=1;}finally{await pool.end();}

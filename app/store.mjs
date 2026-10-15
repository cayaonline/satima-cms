import pg from 'pg';
export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:8,connectionTimeoutMillis:5000,statement_timeout:10000});
export class Problem extends Error {constructor(status,message){super(message);this.status=status;}}
const fields=['registered_business_name','full_name','national_id','primary_phone','physical_address','village_area','sub_location','location','sub_county','county','kra_pin','registration_date','registered_by','status'];
export const farmerCategories=['Satima Farmers','Larger Sagana Farmers','Kangema Farmers','Others'];
export function category(value){if(value==null||value==='')return null;if(!farmerCategories.includes(value))throw new Problem(400,'Choose a valid farmer category.');return value;}
export const farmerGenders=['male','female','not_verified'];
export const farmerLanguages=['English','Kiswahili'];
export function optionalFarmerAttributes(input,old=null){
 const birth=input.date_of_birth===undefined?old?.date_of_birth??null:input.date_of_birth||null;
 if(birth&&(typeof birth!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(birth)||Number.isNaN(Date.parse(birth))||new Date(birth).toISOString().slice(0,10)!==birth||birth>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())))throw new Problem(400,'Enter a valid date of birth.');
 const language=input.preferred_language===undefined?old?.preferred_language??null:input.preferred_language||null;
 if(language&&!farmerLanguages.includes(language))throw new Problem(400,'Choose English or Kiswahili.');
 return {date_of_birth:birth,preferred_language:language};
}
export function genderEvidence(input,old=null){
 const gender=input.gender??old?.gender??'not_verified';
 if(!farmerGenders.includes(gender))throw new Problem(400,'Choose Male, Female or Not verified.');
 if(gender==='not_verified')return {gender,gender_source:null,gender_verified_at:null};
 const source=input.gender_source??(gender===old?.gender?old.gender_source:null);
 if(!['registration_document','farmer_confirmation','supplier_document'].includes(source))throw new Problem(400,'Choose the document or farmer confirmation used to verify gender.');
 return {gender,gender_source:source,gender_verified_at:gender===old?.gender&&source===old?.gender_source?old.gender_verified_at:new Date()};
}
export function text(value, name, required=false, max=300) {
 if(value==null||value===''){if(required)throw new Problem(400,`${name} is required.`);return null;}
 if(typeof value!=='string'||value.trim().length>max)throw new Problem(400,`${name} must be text up to ${max} characters.`);
 const t=value.trim();if(!t&&required)throw new Problem(400,`${name} is required.`);return t||null;
}
export function master(input,complete=true) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Problem(400,'Enter farmer details.');
 const out={};for(const f of fields)out[f]=text(input[f],f,f==='full_name'||(complete&&['primary_phone','registered_by'].includes(f)));
 out.category=category(input.category);
 out.status=out.status||'pending_verification';
 if(!['active','inactive','suspended','pending_verification'].includes(out.status))throw new Problem(400,'Invalid farmer status.');
 if(out.registration_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(out.registration_date)||Number.isNaN(Date.parse(out.registration_date))||new Date(out.registration_date).toISOString().slice(0,10)!==out.registration_date))throw new Problem(400,'Enter a valid registration date.');
 if(out.kra_pin)out.kra_pin=out.kra_pin.toUpperCase();return out;
}
export async function transaction(fn,actor='Local operator') {
 const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.actor',$1,true)",[actor]);const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function createFarmer(c,input) {
 if(input.registration_status&&input.registration_status!=='registered')throw new Problem(400,'Use the directory import for unregistered entries.');
 const data=master(input),gender=genderEvidence(input),optional=optionalFarmerAttributes(input);const vals=fields.map(f=>data[f]);
 const {rows:[f]}=await c.query(`INSERT INTO farmers(${fields.join(',')},category,gender,gender_source,gender_verified_at,date_of_birth,preferred_language) VALUES(${vals.map((_,i)=>'$'+(i+1)).join(',')},$${vals.length+1},$${vals.length+2},$${vals.length+3},$${vals.length+4},$${vals.length+5},$${vals.length+6}) RETURNING *`,[...vals,data.category,gender.gender,gender.gender_source,gender.gender_verified_at,optional.date_of_birth,optional.preferred_language]);
 await related(c,f.id,input);await evidence(c,f.id,input);return f;
}
async function related(c,id,input) {
 if(input.contact){
 const a=input.contact;const vals=[id,text(a.full_name,'Contact name',true),text(a.phone_number,'Contact phone',true),text(a.relationship,'Relationship',true)];
 const {rows:[old]}=await c.query('SELECT id FROM farmer_contacts WHERE farmer_id=$1 AND is_primary_alternative',[id]);
 if(old)await c.query('UPDATE farmer_contacts SET full_name=$2,phone_number=$3,relationship=$4 WHERE farmer_id=$1 AND id=$5', [...vals,old.id]);
 else await c.query("INSERT INTO farmer_contacts(farmer_id,full_name,phone_number,relationship,is_primary_alternative) VALUES($1,$2,$3,$4,true)",vals);
 }
 if(input.payment){
 const a=input.payment, name=text(a.mpesa_registered_name,'M-Pesa name',true),phone=text(a.mpesa_phone_number,'M-Pesa phone',true);
 const {rows:[old]}=await c.query('SELECT * FROM farmer_payment_profiles WHERE farmer_id=$1 AND is_active',[id]);
 if(!old||old.mpesa_registered_name!==name||old.mpesa_phone_number!==phone){
 if(old)await c.query('UPDATE farmer_payment_profiles SET is_active=false WHERE id=$1',[old.id]);
 await c.query('INSERT INTO farmer_payment_profiles(farmer_id,mpesa_registered_name,mpesa_phone_number) VALUES($1,$2,$3)',[id,name,phone]);
 }
 if(Object.hasOwn(a,'verified')){
 if(typeof a.verified!=='boolean')throw new Problem(400,'Payment verification must be Yes or No.');
 const at=a.verified?timestamp(a.verified_at,'Payment verification date'):null;
 await c.query('UPDATE farmer_payment_profiles SET verified=$2,verified_at=$3 WHERE farmer_id=$1 AND is_active AND (verified IS DISTINCT FROM $2 OR verified_at IS DISTINCT FROM $3::timestamptz)',[id,a.verified,at]);
 }
 }
}
export async function updateFarmer(c,id,input){
 const {rows:[old]}=await c.query('SELECT *,date_of_birth::text,updated_at::text AS revision FROM farmers WHERE id=$1 FOR UPDATE',[id]);
 if(!old)throw new Problem(404,'Farmer not found.');
 if(input.revision!==old.revision)throw new Problem(409,'This record changed. Reload it before saving.');
 const registrationStatus=input.registration_status||old.registration_status;
 if(!['registered','not_registered','review_required'].includes(registrationStatus))throw new Problem(400,'Invalid registration status.');
 if(old.registration_status==='registered'&&registrationStatus!=='registered')throw new Problem(400,'Completed registration cannot be reversed.');
 const promote=old.registration_status!=='registered'&&registrationStatus==='registered';
 // Older paper registrations may have no recorded field officer. Keep that
 // field unknown when editing another attribute; new registrations still need it.
 const data=master(input,registrationStatus==='registered'&&old.registered_by!==null);
 if(registrationStatus==='registered'&&!data.primary_phone)throw new Problem(400,'primary_phone is required.');
 if(promote&&!data.registered_by)throw new Problem(400,'registered_by is required.');
 const gender=genderEvidence(input,old),optional=optionalFarmerAttributes(input,old);
 if(promote&&!data.registration_date)throw new Problem(400,'Enter the actual registration date to complete registration.');
 if(promote){
  if(old.registration_status==='review_required'&&(await c.query("SELECT 1 FROM farmer_data_issues WHERE farmer_id=$1 AND status='open' LIMIT 1",[id])).rowCount)throw new Problem(409,'Resolve the identity review before completing registration.');
  const duplicate=await c.query(`SELECT 1 FROM farmers WHERE id<>$1 AND record_kind='registered' AND registration_status='registered'
   AND ((length(regexp_replace(coalesce(primary_phone,''),'[^0-9]','','g'))>=9
    AND regexp_replace(regexp_replace(primary_phone,'[^0-9]','','g'),'^254','0')=regexp_replace(regexp_replace($2,'[^0-9]','','g'),'^254','0'))
    OR ($3::text IS NOT NULL AND national_id=$3)) LIMIT 1`,[id,data.primary_phone,data.national_id]);
  if(duplicate.rowCount)throw new Problem(409,'Possible existing registration. Review the phone or National ID before completing this profile.');
 }
 if(registrationStatus!=='registered'&&data.status!=='pending_verification')throw new Problem(400,'Unregistered entries cannot be activated.');
 if(old.primary_phone!==data.primary_phone)await c.query('UPDATE farmers SET primary_phone_normalized=NULL WHERE id=$1',[id]);
 await c.query(`UPDATE farmers SET ${fields.map((f,i)=>f+'=$'+(i+2)).join(',')},category=$${fields.length+2},registration_status=$${fields.length+3},gender=$${fields.length+4},gender_source=$${fields.length+5},gender_verified_at=$${fields.length+6},date_of_birth=$${fields.length+7},preferred_language=$${fields.length+8}${promote?',customer_id=next_farmer_customer_id()':''} WHERE id=$1`,[id,...fields.map(f=>data[f]),data.category,registrationStatus,gender.gender,gender.gender_source,gender.gender_verified_at,optional.date_of_birth,optional.preferred_language]);
 await related(c,id,input);await evidence(c,id,input);return {id};
}
export async function detail(id){
 const {rows:[f]}=await pool.query('SELECT *,registration_date::text,date_of_birth::text,updated_at::text AS revision,EXISTS(SELECT FROM farmer_photographs p WHERE p.farmer_id=farmers.id) AS has_photograph FROM farmers WHERE id=$1',[id]);
 if(!f)throw new Problem(404,'Farmer not found.');
 const children={contacts:'farmer_contacts',payments:'farmer_payment_profiles',consents:'farmer_consents',verifications:'farmer_verifications',sources:'farmer_registration_sources',directory_sources:'farmer_directory_sources',issues:'farmer_data_issues',audit:'farmer_audit_events'};
 for(const [key,t] of Object.entries(children))f[key]=(await pool.query(`SELECT *${key==='issues'?',updated_at::text AS revision':''} FROM ${t} WHERE farmer_id=$1 ORDER BY ${['sources','directory_sources'].includes(key)?'imported_at':'created_at'} DESC,id DESC${key==='audit'?' LIMIT 30':''}`,[id])).rows;
 return f;
}

export const verificationChecks=['national_id_verified','kra_pin_verified','primary_phone_verified','mpesa_number_verified','mpesa_registered_name_confirmed','registration_form_complete','consent_obtained'];
const consentChecks=['information_accuracy_confirmed','data_processing_consent','communications_consent','consent_given'];
function tristate(value){if(value===null||value===undefined)return null;if(typeof value!=='boolean')throw new Problem(400,'Choose Yes, No or Not recorded.');return value;}
function timestamp(value,label){const v=text(value,label,true);if(!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)||Number.isNaN(Date.parse(v)))throw new Problem(400,`${label} must be a valid date and time.`);return new Date(v).toISOString();}
async function evidence(c,id,input){
 for(const [key,table,checks,extra] of [
 ['verification','farmer_verifications',verificationChecks,['verified_by','verified_at','notes']],
 ['consent','farmer_consents',consentChecks,['consent_version','signed_name','signature_method','consent_date']]]){
 const a=input[key];if(!a)continue;
 const {rows:[old]}=await c.query(`SELECT * FROM ${table} WHERE farmer_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[id]);
 if((a.previous_id||null)!==(old?.id||null))throw new Problem(409,'Evidence changed. Reload before saving.');
 const data={};for(const field of checks)data[field]=tristate(a[field]);
 for(const field of extra)data[field]=field.endsWith('_at')||field==='consent_date'?timestamp(a[field],prettyField(field)):text(a[field],prettyField(field),['verified_by','consent_version'].includes(field),field==='notes'?2000:300);
 if(key==='consent'&&data.signature_method&&!['signature','thumbprint','digital'].includes(data.signature_method))throw new Problem(400,'Invalid signature method.');
 const names=[...checks,...extra];
 const changed=!old||(key==='verification'&&!old.verified_details)||names.some(k=>(old[k] instanceof Date?old[k].toISOString():old[k])!==data[k]);
 if(changed){
 if(key==='consent'&&old?.withdrawn_at){names.push('withdrawn_at');data.withdrawn_at=old.withdrawn_at;}
 await c.query(`INSERT INTO ${table}(farmer_id,${names.join(',')},created_at) VALUES(${[id,...names].map((_,i)=>'$'+(i+1)).join(',')},clock_timestamp())`,[id,...names.map(k=>data[k])]);
 }
 }
 if(input.issues!==undefined){
 if(!Array.isArray(input.issues)||input.issues.length>100)throw new Problem(400,'Invalid cleaning notes.');
 for(const a of input.issues){
 const field=text(a.field_name,'Field',true),description=text(a.description,'Cleaning note',true,2000);
 if(!['open','resolved'].includes(a.status)||!['review','high'].includes(a.severity))throw new Problem(400,'Invalid cleaning note status or severity.');
 const resolution=text(a.resolution_note,'Resolution note',a.status==='resolved',2000);
 const result=await c.query(`UPDATE farmer_data_issues SET field_name=$3,description=$4,severity=$5,status=$6,resolution_note=$7,resolved_at=CASE WHEN $6='resolved' THEN coalesce(resolved_at,now()) ELSE NULL END WHERE id=$1 AND farmer_id=$2 AND updated_at::text=$8 RETURNING id`,[a.id,id,field,description,a.severity,a.status,resolution,a.revision]);
 if(!result.rowCount)throw new Problem(409,'A cleaning note changed. Reload before saving.');
 }
 }
}
const prettyField=s=>s.replaceAll('_',' ');

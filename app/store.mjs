import pg from 'pg';
export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:8,connectionTimeoutMillis:5000,statement_timeout:10000});
export class Problem extends Error {constructor(status,message){super(message);this.status=status;}}
const fields=['registered_business_name','full_name','national_id','primary_phone','physical_address','village_area','sub_location','location','sub_county','county','kra_pin','registration_date','registered_by','status'];
export function text(value, name, required=false, max=300) {
 if(value==null||value===''){if(required)throw new Problem(400,`${name} is required.`);return null;}
 if(typeof value!=='string'||value.trim().length>max)throw new Problem(400,`${name} must be text up to ${max} characters.`);
 const t=value.trim();if(!t&&required)throw new Problem(400,`${name} is required.`);return t||null;
}
export function master(input) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Problem(400,'Enter farmer details.');
 const out={};for(const f of fields)out[f]=text(input[f],f,['full_name','primary_phone','registered_by'].includes(f));
 out.status=out.status||'pending_verification';
 if(!['active','inactive','suspended','pending_verification'].includes(out.status))throw new Problem(400,'Invalid farmer status.');
 if(out.registration_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(out.registration_date)||Number.isNaN(Date.parse(out.registration_date))||new Date(out.registration_date).toISOString().slice(0,10)!==out.registration_date))throw new Problem(400,'Enter a valid registration date.');
 if(out.kra_pin)out.kra_pin=out.kra_pin.toUpperCase();return out;
}
export async function transaction(fn,actor='Local operator') {
 const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.actor',$1,true)",[actor]);const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function createFarmer(c,input) {
 const data=master(input);const vals=fields.map(f=>data[f]);
 const {rows:[f]}=await c.query(`INSERT INTO farmers(${fields.join(',')}) VALUES(${vals.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,vals);
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
 const {rows:[old]}=await c.query('SELECT *,updated_at::text AS revision FROM farmers WHERE id=$1 FOR UPDATE',[id]);
 if(!old)throw new Problem(404,'Farmer not found.');
 if(input.revision!==old.revision)throw new Problem(409,'This record changed. Reload it before saving.');
 const data=master(input);
 if(old.primary_phone!==data.primary_phone)await c.query('UPDATE farmers SET primary_phone_normalized=NULL WHERE id=$1',[id]);
 await c.query(`UPDATE farmers SET ${fields.map((f,i)=>f+'=$'+(i+2)).join(',')} WHERE id=$1`,[id,...fields.map(f=>data[f])]);
 await related(c,id,input);await evidence(c,id,input);return {id};
}
export async function detail(id){
 const {rows:[f]}=await pool.query('SELECT *,registration_date::text,updated_at::text AS revision FROM farmers WHERE id=$1',[id]);
 if(!f)throw new Problem(404,'Farmer not found.');
 const children={contacts:'farmer_contacts',payments:'farmer_payment_profiles',consents:'farmer_consents',verifications:'farmer_verifications',sources:'farmer_registration_sources',issues:'farmer_data_issues',audit:'farmer_audit_events'};
 for(const [key,t] of Object.entries(children))f[key]=(await pool.query(`SELECT *${key==='issues'?',updated_at::text AS revision':''} FROM ${t} WHERE farmer_id=$1 ORDER BY ${key==='sources'?'imported_at':'created_at'} DESC,id DESC${key==='audit'?' LIMIT 30':''}`,[id])).rows;
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
 const changed=!old||names.some(k=>(old[k] instanceof Date?old[k].toISOString():old[k])!==data[k]);
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

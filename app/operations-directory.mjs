import {Problem,farmerCategories,farmerGenders} from './store.mjs';

const sorts={
 customer_id:"substring(f.customer_id from 6)::numeric",
 full_name:'lower(f.full_name)',
 registration_date:'f.registration_date',
 created_at:'f.created_at',
 category:'f.category'
};
const registration="CASE WHEN f.registration_status='registered' THEN 'registered' ELSE 'not_registered' END";

export function operationsDirectoryQuery(params){
 for(const key of params.keys())if(!['q','category','registration','gender','sort','direction','page','page_size'].includes(key))throw new Problem(400,'Invalid directory filter.');
 const integer=(key,fallback,max)=>{const value=params.get(key);if(value===null)return fallback;if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)throw new Problem(400,'Invalid '+key);return Number(value);};
 const page=integer('page',1,1000000),pageSize=integer('page_size',50,500);
 const category=params.get('category')||'',filter=params.get('registration')||'',gender=params.get('gender')||'',sort=params.get('sort')||'customer_id',direction=params.get('direction')||'asc';
 const q=(params.get('q')||'').trim();
 if(category&&!farmerCategories.includes(category)||filter&&!['registered','not_registered'].includes(filter)||gender&&!farmerGenders.includes(gender)||!Object.hasOwn(sorts,sort)||!['asc','desc'].includes(direction)||q.length>100)throw new Problem(400,'Invalid directory filter or sort.');
 const values=[],bind=value=>{values.push(value);return '$'+values.length;};
 const conditions=["f.record_kind='registered'","f.master_list_status='current'"];
 if(category)conditions.push('f.category='+bind(category));
 if(filter)conditions.push(registration+'='+bind(filter));
 if(gender)conditions.push('f.gender='+bind(gender));
 if(q){const term=bind(q.toLowerCase()),genderTerm=q.toLowerCase().replaceAll(' ','_');conditions.push('('+[...['customer_id','full_name','registered_business_name','primary_phone','kra_pin','village_area','location','county'].map(field=>`position(${term} in lower(coalesce(f.${field},'')))>0`),...(farmerGenders.includes(genderTerm)?['f.gender='+bind(genderTerm)]:[])].join(' OR ')+')');}
 const limit=bind(pageSize),offset=bind((page-1)*pageSize);
 const sql=`WITH filtered AS MATERIALIZED (SELECT f.id,f.customer_id,f.category,f.full_name,f.primary_phone,f.kra_pin,f.gender,f.village_area,f.location,f.county,f.registration_date,f.created_at,${registration} AS registration_status FROM farmers f WHERE ${conditions.join(' AND ')}),
 stats AS (SELECT count(*)::int AS total,
 count(*) FILTER(WHERE registration_status='registered')::int AS registered,
 count(*) FILTER(WHERE registration_status='not_registered')::int AS not_registered,
 json_build_object('Satima Farmers',count(*) FILTER(WHERE category='Satima Farmers'),
 'Larger Sagana Farmers',count(*) FILTER(WHERE category='Larger Sagana Farmers'),
 'Kangema Farmers',count(*) FILTER(WHERE category='Kangema Farmers'),
 'Others',count(*) FILTER(WHERE category='Others')) AS categories FROM filtered),
 paged AS (SELECT f.id,f.customer_id,f.category,f.full_name,f.primary_phone,f.kra_pin,f.gender,f.village_area,f.location,f.county,f.registration_status,f.registration_date::text FROM filtered f ORDER BY ${sorts[sort]} ${direction} NULLS LAST,f.id ${direction} LIMIT ${limit} OFFSET ${offset})
 SELECT row_to_json(stats) AS stats,coalesce((SELECT json_agg(paged) FROM paged),'[]'::json) AS farmers FROM stats`;
 return {sql,values,page,pageSize,sort,direction};
}

export async function listOperationsFarmers(pool,params){
 const query=operationsDirectoryQuery(params),{rows:[data]}=await pool.query(query.sql,query.values);
 return {...data,pagination:{page:query.page,page_size:query.pageSize,total:data.stats.total,total_pages:Math.ceil(data.stats.total/query.pageSize),sort:query.sort,direction:query.direction}};
}

export async function operationsFarmerDetail(pool,id){
 const {rows:[farmer]}=await pool.query(`SELECT f.id,f.customer_id,f.category,f.full_name,f.registered_business_name,f.primary_phone,f.kra_pin,f.gender,
 f.village_area,f.sub_location,f.location,f.sub_county,f.county,f.registration_date::text,
 ${registration} AS registration_status,EXISTS(SELECT FROM farmer_photographs p WHERE p.farmer_id=f.id) AS has_photograph
 FROM farmers f WHERE f.id=$1 AND f.record_kind='registered'`,[id]);
 if(!farmer)throw new Problem(404,'Farmer not found.');
 const [registrationSources,directorySources]=await Promise.all([
  pool.query('SELECT document_name,first_page,last_page FROM farmer_registration_sources WHERE farmer_id=$1 ORDER BY imported_at DESC',[id]),
  pool.query('SELECT document_name,page_number FROM farmer_directory_sources WHERE farmer_id=$1 ORDER BY imported_at DESC',[id])
 ]);
 return {...farmer,registration_sources:registrationSources.rows,directory_sources:directorySources.rows};
}

// This projection is reachable only through the elevated Operations route. It
// deliberately omits administrative notes and audit history from its response.
export async function operationsFarmerRegistrationDetail(pool,id,viewerUsername){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const {rows:[farmer]}=await client.query(`SELECT id,national_id,kra_pin,physical_address,registered_by
   FROM farmers WHERE id=$1 AND record_kind='registered'`,[id]);
  if(!farmer)throw new Problem(404,'Farmer not found.');
  const [contacts,payments,consents,verifications,sources,directorySources]=await Promise.all([
   client.query(`SELECT full_name,phone_number,relationship,contact_type,is_primary_alternative FROM farmer_contacts WHERE farmer_id=$1 ORDER BY created_at DESC,id DESC`,[id]),
   client.query(`SELECT mpesa_registered_name,mpesa_phone_number,verified,is_active FROM farmer_payment_profiles WHERE farmer_id=$1 ORDER BY created_at DESC,id DESC`,[id]),
   client.query(`SELECT consent_version,information_accuracy_confirmed,data_processing_consent,communications_consent,consent_given,signed_name,signature_method,consent_date,withdrawn_at FROM farmer_consents WHERE farmer_id=$1 ORDER BY created_at DESC,id DESC`,[id]),
   client.query(`SELECT national_id_verified,kra_pin_verified,primary_phone_verified,mpesa_number_verified,mpesa_registered_name_confirmed,registration_form_complete,consent_obtained,verified_by,verified_at,notes FROM farmer_verifications WHERE farmer_id=$1 ORDER BY created_at DESC,id DESC`,[id]),
   client.query(`SELECT document_name,first_page,last_page,raw_transcription,imported_at FROM farmer_registration_sources WHERE farmer_id=$1 ORDER BY imported_at DESC,id DESC`,[id]),
   client.query(`SELECT document_name,page_number FROM farmer_directory_sources WHERE farmer_id=$1 ORDER BY imported_at DESC,id DESC`,[id])
  ]);
  await client.query('INSERT INTO farmer_sensitive_access_events(farmer_id,viewer_username) VALUES($1,$2)',[id,viewerUsername]);
  await client.query('COMMIT');
  return {...farmer,contacts:contacts.rows,payments:payments.rows,consents:consents.rows,verifications:verifications.rows,sources:sources.rows,directory_sources:directorySources.rows};
 }catch(error){await client.query('ROLLBACK');throw error;}
 finally{client.release();}
}

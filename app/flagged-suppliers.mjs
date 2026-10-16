import {Problem,text} from './store.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const categories=['Satima Farmers','Larger Sagana Farmers','Kangema Farmers','Others'];
// A flag is one unresolved supplier-list row, even when several CMS farmers
// are possible matches. Resolving its last matching issue removes the flag.
export async function listFlaggedSuppliers(pool){
 const {rows}=await pool.query(`WITH latest AS (
   SELECT document_sha256 FROM farmer_master_sources ORDER BY imported_at DESC LIMIT 1
 )
 SELECT s.id,s.row_number,s.source_name,s.source_category,
   (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object(
      'id',f.id,'customer_id',f.customer_id,'full_name',f.full_name,
      'category',f.category,'registration_status',f.registration_status
    )),'[]'::jsonb)
    FROM farmer_data_issues i JOIN farmers f ON f.id=i.farmer_id
    WHERE i.status='open' AND i.field_name='master_supplier_match'
      AND i.description LIKE 'Supplier master row '||s.row_number::text||':%'
      AND i.created_at>=s.imported_at) AS candidates
 FROM farmer_master_sources s,latest
 WHERE s.document_sha256=latest.document_sha256 AND s.match_result='review_required'
   AND NOT EXISTS (SELECT 1 FROM farmer_master_reviews r WHERE r.source_id=s.id AND r.decision IN ('match','create'))
   AND (EXISTS (SELECT 1 FROM farmer_data_issues i WHERE i.status='open' AND i.field_name='master_supplier_match'
      AND i.description LIKE 'Supplier master row '||s.row_number::text||':%' AND i.created_at>=s.imported_at)
    OR NOT EXISTS (SELECT 1 FROM farmer_data_issues i WHERE i.field_name='master_supplier_match'
      AND i.description LIKE 'Supplier master row '||s.row_number::text||':%' AND i.created_at>=s.imported_at))
 ORDER BY s.row_number`);
 return {total:rows.length,records:rows};
}

export async function flaggedSupplierDetail(pool,sourceId){
 if(!uuid.test(sourceId))throw new Problem(400,'Invalid supplier source.');
 const {rows:[source]}=await pool.query(`SELECT id,document_name,sheet_name,row_number,source_name,source_phone,source_category,review_reason,farmer_id,match_result,imported_at
  FROM farmer_master_sources WHERE id=$1`,[sourceId]);
 if(!source)throw new Problem(404,'Supplier source not found.');
 const {rows:candidates}=await pool.query(`SELECT DISTINCT f.id,f.customer_id,f.full_name,f.primary_phone,f.category,f.registration_status,f.updated_at::text AS revision
  FROM farmer_data_issues i JOIN farmers f ON f.id=i.farmer_id
  WHERE i.status='open' AND i.field_name='master_supplier_match'
   AND i.description LIKE 'Supplier master row '||$1::int::text||':%' AND i.created_at>=$2 ORDER BY f.full_name`,[source.row_number,source.imported_at]);
 const {rows:history}=await pool.query('SELECT decision,farmer_id,approved_fields,note,actor,created_at FROM farmer_master_reviews WHERE source_id=$1 ORDER BY created_at DESC',[sourceId]);
 return {source,candidates,history};
}

export async function reviewFlaggedSupplier(client,sourceId,input,actor){
 if(!uuid.test(sourceId))throw new Problem(400,'Invalid supplier source.');
 if(!input||!['match','create','defer'].includes(input.decision))throw new Problem(400,'Choose a review decision.');
 const note=typeof input.note==='string'?input.note.trim():'';
 if(note.length>1000)throw new Problem(400,'Review note is too long.');
 if(input.decision==='defer'&&!note)throw new Problem(400,'Add a note explaining what requires further review.');
 const {rows:[source]}=await client.query('SELECT * FROM farmer_master_sources WHERE id=$1 FOR UPDATE',[sourceId]);
 if(!source)throw new Problem(404,'Supplier source not found.');
 if(source.match_result!=='review_required')throw new Problem(409,'This supplier row has already been resolved.');
 const {rows:[final]}=await client.query("SELECT id FROM farmer_master_reviews WHERE source_id=$1 AND decision IN ('match','create')",[sourceId]);
 if(final)throw new Problem(409,'This supplier row has already been resolved.');
 let farmerId=null,approved={};
 if(input.decision==='match'){
  if(!uuid.test(input.farmer_id||''))throw new Problem(400,'Select an existing farmer.');
  const {rows:[candidate]}=await client.query(`SELECT f.id,f.full_name,f.primary_phone,f.category,f.updated_at::text AS revision FROM farmer_data_issues i JOIN farmers f ON f.id=i.farmer_id
   WHERE i.status='open' AND i.field_name='master_supplier_match' AND i.description LIKE 'Supplier master row '||$1::int::text||':%' AND i.created_at>=$3 AND f.id=$2 FOR UPDATE OF f`,[source.row_number,input.farmer_id,source.imported_at]);
  if(!candidate)throw new Problem(409,'The selected farmer is not a current candidate. Reload the review.');
  if(candidate.revision!==input.expected_revision)throw new Problem(409,'This farmer changed since the review opened. Reload and compare again.');
  farmerId=candidate.id;
  const fields=Array.isArray(input.approved_fields)?input.approved_fields:[];
  if(fields.some(field=>!['full_name','primary_phone','category'].includes(field))||new Set(fields).size!==fields.length)throw new Problem(400,'Invalid approved fields.');
  if(fields.includes('full_name'))approved.full_name=text(source.source_name,'Source name',true,300);
  if(fields.includes('primary_phone')){if(!source.source_phone)throw new Problem(400,'Source phone is unavailable.');approved.primary_phone=text(source.source_phone,'Source phone',true,300);}
  if(fields.includes('category')){if(!categories.includes(source.source_category))throw new Problem(400,'Source category is unavailable.');approved.category=source.source_category;}
  if(Object.keys(approved).length){const names=Object.keys(approved);await client.query(`UPDATE farmers SET ${names.map((name,index)=>`${name}=$${index+2}`).join(',')} WHERE id=$1`,[farmerId,...Object.values(approved)]);}
  await client.query("UPDATE farmers SET master_list_status='current' WHERE id=$1",[farmerId]);
 }else if(input.decision==='create'){
  const sourceName=text(source.source_name,'Source name',true,300),sourcePhone=text(source.source_phone,'Source phone',false,300);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('satima-farmer-source-create'))");
  const {rows:[duplicate]}=await client.query(`SELECT id FROM farmers WHERE lower(btrim(full_name))=lower(btrim($1))
   OR ($2::text IS NOT NULL AND length(regexp_replace($2,'[^0-9]','','g'))>=9
    AND right(regexp_replace(primary_phone,'[^0-9]','','g'),9)=right(regexp_replace($2,'[^0-9]','','g'),9)) LIMIT 1`,[sourceName,sourcePhone]);
  if(duplicate)throw new Problem(409,'A farmer with this name or phone exists. Review the match before creating another.');
  const category=categories.includes(source.source_category)?source.source_category:null;
  const {rows:[created]}=await client.query(`INSERT INTO farmers(customer_id,full_name,primary_phone,registered_by,registration_date,status,record_kind,registration_status,category,master_list_status)
   VALUES(NULL,$1,$2,NULL,NULL,'pending_verification','registered','not_registered',$3,'current') RETURNING id`,[sourceName,sourcePhone,category]);
  farmerId=created.id;
 }
 if(farmerId){await client.query("UPDATE farmer_master_sources SET farmer_id=$2,match_result=$3,review_reason=NULL WHERE id=$1",[sourceId,farmerId,input.decision==='create'?'added':'matched']);
  await client.query(`UPDATE farmer_data_issues SET status='resolved',resolved_at=now(),resolution_note=$2
   WHERE status='open' AND field_name='master_supplier_match' AND description LIKE 'Supplier master row '||$1::int::text||':%' AND created_at>=$3`,[source.row_number,`Resolved against supplier source ${sourceId} by ${actor}: ${input.decision}. ${note}`,source.imported_at]);}
 const {rows:[review]}=await client.query('INSERT INTO farmer_master_reviews(source_id,farmer_id,decision,approved_fields,note,actor) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,farmer_id,decision',[sourceId,farmerId,input.decision,JSON.stringify(approved),note||null,actor]);
 return review;
}

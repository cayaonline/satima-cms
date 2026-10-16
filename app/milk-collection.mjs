import {Problem} from './store.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const categories=['Satima Farmers','Larger Sagana Farmers','Kangema Farmers','Others'];
const today=()=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
const dateValid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const quantityValid=value=>/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(value||'')&&Number(value)>0&&Number(value)<1000000;
const pageNumber=value=>Math.max(1,Math.min(100000,Number.parseInt(value||'1',10)||1));

export function milkSubmission(headers){
 const farmerId=headers['x-farmer-id'],quantity=headers['x-quantity-liters'],dateReceived=headers['x-date-received'],key=headers['x-idempotency-key'];
 if(!uuid.test(farmerId||''))throw new Problem(400,'Select a farmer from the directory.');
 if(!quantityValid(quantity))throw new Problem(400,'Enter a positive quantity in liters with up to six decimal places.');
 if(!dateValid(dateReceived)||dateReceived>today())throw new Problem(400,'Choose today or an earlier valid delivery date.');
 if(!uuid.test(key||''))throw new Problem(400,'Refresh the form and try again.');
 return {farmerId,quantity,dateReceived,key};
}

export async function saveMilkCollection(client,input,photo,actor,portal){
 const {rows:[existing]}=await client.query('SELECT m.id,m.collection_id,m.farmer_id,m.quantity_liters::text,m.date_received::text,p.sha256 FROM milk_collections m JOIN milk_collection_photos p ON p.collection_id=m.id WHERE m.idempotency_key=$1',[input.key]);
 if(existing){
  if(existing.farmer_id!==input.farmerId||Number(existing.quantity_liters)!==Number(input.quantity)||existing.date_received!==input.dateReceived||existing.sha256!==photo.sha256)throw new Problem(409,'This submission key was already used for another collection.');
  return {id:existing.id,collection_id:existing.collection_id,already_saved:true};
 }
 const {rows:[farmer]}=await client.query('SELECT id,category FROM farmers WHERE id=$1',[input.farmerId]);
 if(!farmer)throw new Problem(404,'Farmer not found.');
 const {rows:[record]}=await client.query(`INSERT INTO milk_collections(farmer_id,supplier_category_at_collection,quantity_liters,date_received,recorded_by,source_portal,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,collection_id`,[farmer.id,farmer.category,input.quantity,input.dateReceived,actor,portal,input.key]);
 await client.query('INSERT INTO milk_collection_photos(collection_id,content_type,image_data,sha256) VALUES($1,$2,$3,$4)',[record.id,photo.contentType,photo.bytes,photo.sha256]);
 return record;
}

export async function searchMilkFarmers(pool,query){
 const q=(query||'').trim().slice(0,100);
 if(q.length<2)return [];
 const {rows}=await pool.query(`SELECT id,customer_id,full_name,category,registration_status FROM farmers WHERE lower(full_name) LIKE $1 ESCAPE E'\\\\' OR lower(coalesce(customer_id,'')) LIKE $1 ESCAPE E'\\\\' ORDER BY CASE WHEN lower(coalesce(customer_id,''))=lower($2) THEN 0 ELSE 1 END,lower(full_name),id LIMIT 12`,['%'+q.toLowerCase().replace(/[\\%_]/g,'\\$&')+'%',q]);
 return rows;
}

function filters(params){
 const q=(params.get('q')||'').trim().toLowerCase().slice(0,120),category=params.get('category')||'',farmer=params.get('farmer')||'',period=params.get('period')||'',from=params.get('from')||'',to=params.get('to')||'';
 const sort=params.get('sort')||'newest';
 if(category&&!categories.includes(category)&&category!=='unassigned')throw new Problem(400,'Invalid supplier category.');
 if(farmer&&!uuid.test(farmer))throw new Problem(400,'Invalid farmer.');
 if(period&&!['today','week','month'].includes(period))throw new Problem(400,'Invalid date range.');
 if(from&&!dateValid(from)||to&&!dateValid(to)||from&&to&&from>to)throw new Problem(400,'Invalid date range.');
 if(!['newest','oldest','quantity_desc','quantity_asc','farmer'].includes(sort))throw new Problem(400,'Invalid sorting.');
 const clauses=[],values=[];const add=(expression,value)=>{values.push(value);clauses.push(expression.replace('?',`$${values.length}`));};
 if(q)add("lower(m.collection_id||' '||coalesce(f.customer_id,'')||' '||f.full_name||' '||coalesce(m.supplier_category_at_collection,'Awaiting Categorisation')||' '||m.quantity_liters::text||' '||m.date_received::text) LIKE ? ESCAPE E'\\\\'",'%'+q.replace(/[\\%_]/g,'\\$&')+'%');
 if(category)category==='unassigned'?clauses.push('m.supplier_category_at_collection IS NULL'):add('m.supplier_category_at_collection=?',category);
 if(farmer)add('m.farmer_id=?',farmer);
 if(period)clauses.push({today:"m.date_received=(now() AT TIME ZONE 'Africa/Nairobi')::date",week:"m.date_received>=date_trunc('week',now() AT TIME ZONE 'Africa/Nairobi')::date",month:"m.date_received>=date_trunc('month',now() AT TIME ZONE 'Africa/Nairobi')::date"}[period]);
 if(from)add('m.date_received>=?',from);if(to)add('m.date_received<=?',to);
 return {where:clauses.length?'WHERE '+clauses.join(' AND '):'',values,sort};
}
const sortSql={newest:'m.date_received DESC,m.created_at DESC,m.id DESC',oldest:'m.date_received ASC,m.created_at ASC,m.id ASC',quantity_desc:'m.quantity_liters DESC,m.date_received DESC,m.id DESC',quantity_asc:'m.quantity_liters ASC,m.date_received DESC,m.id DESC',farmer:'lower(f.full_name),m.date_received DESC,m.id DESC'};

export async function listMilkCollections(pool,params){
 const {where,values,sort}=filters(params),page=pageNumber(params.get('page')),size=30;
 const {rows:[totals]}=await pool.query(`SELECT count(*)::int AS total,count(DISTINCT m.farmer_id)::int AS unique_farmers,coalesce(sum(m.quantity_liters),0)::text AS total_liters FROM milk_collections m JOIN farmers f ON f.id=m.farmer_id ${where}`,values);
 const {rows}=await pool.query(`SELECT m.id,m.collection_id,m.farmer_id,f.customer_id AS farmer_code,f.full_name AS farmer_name,m.supplier_category_at_collection AS category,m.quantity_liters::text,m.date_received::text,m.recorded_by,m.source_portal,m.created_at FROM milk_collections m JOIN farmers f ON f.id=m.farmer_id ${where} ORDER BY ${sortSql[sort]} LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,size,(page-1)*size]);
 return {records:rows,pagination:{page,page_size:size,total:totals.total,total_pages:Math.max(1,Math.ceil(totals.total/size))},total_liters:totals.total_liters,unique_farmers:totals.unique_farmers};
}

export async function milkSummary(pool,params=new URLSearchParams()){
 if(params.has('from')||params.has('to')){
  const {where,values}=filters(new URLSearchParams({from:params.get('from')||'',to:params.get('to')||''}));
  const {rows:[totals]}=await pool.query(`SELECT count(*)::int AS period_records,count(DISTINCT m.farmer_id)::int AS unique_farmers,coalesce(sum(m.quantity_liters),0)::text AS period_liters FROM milk_collections m JOIN farmers f ON f.id=m.farmer_id ${where}`,values);
  const {rows:daily}=await pool.query(`SELECT m.date_received::text AS label,sum(m.quantity_liters)::text AS liters FROM milk_collections m JOIN farmers f ON f.id=m.farmer_id ${where} GROUP BY m.date_received ORDER BY m.date_received`,values);
  const {rows:weekly}=await pool.query(`SELECT date_trunc('week',m.date_received)::date::text AS label,sum(m.quantity_liters)::text AS liters FROM milk_collections m JOIN farmers f ON f.id=m.farmer_id ${where} GROUP BY 1 ORDER BY 1`,values);
  const {rows:monthly}=await pool.query(`SELECT date_trunc('month',m.date_received)::date::text AS label,sum(m.quantity_liters)::text AS liters FROM milk_collections m JOIN farmers f ON f.id=m.farmer_id ${where} GROUP BY 1 ORDER BY 1`,values);
  const {rows:categories}=await pool.query(`SELECT coalesce(m.supplier_category_at_collection,'Awaiting Categorisation') AS category,coalesce(sum(m.quantity_liters),0)::text AS liters,count(*)::int AS deliveries FROM milk_collections m JOIN farmers f ON f.id=m.farmer_id ${where} GROUP BY 1 ORDER BY 1`,values);
  return {totals,daily,weekly,monthly,categories};
 }
 const {rows:[totals]}=await pool.query(`SELECT coalesce(sum(quantity_liters) FILTER (WHERE date_received=(now() AT TIME ZONE 'Africa/Nairobi')::date),0)::text AS today_liters,coalesce(sum(quantity_liters) FILTER (WHERE date_received>=date_trunc('week',now() AT TIME ZONE 'Africa/Nairobi')::date),0)::text AS week_liters,coalesce(sum(quantity_liters) FILTER (WHERE date_received>=date_trunc('month',now() AT TIME ZONE 'Africa/Nairobi')::date),0)::text AS month_liters,count(DISTINCT farmer_id) FILTER (WHERE date_received=(now() AT TIME ZONE 'Africa/Nairobi')::date)::int AS farmers_today FROM milk_collections`);
 const {rows:daily}=await pool.query(`SELECT day::date::text AS label,coalesce(sum(m.quantity_liters),0)::text AS liters FROM generate_series((now() AT TIME ZONE 'Africa/Nairobi')::date-29,(now() AT TIME ZONE 'Africa/Nairobi')::date,interval '1 day') AS days(day) LEFT JOIN milk_collections m ON m.date_received=day::date GROUP BY day ORDER BY day`);
 const {rows:weekly}=await pool.query(`SELECT start::date::text AS label,coalesce(sum(m.quantity_liters),0)::text AS liters FROM generate_series(date_trunc('week',now() AT TIME ZONE 'Africa/Nairobi')-interval '11 weeks',date_trunc('week',now() AT TIME ZONE 'Africa/Nairobi'),interval '1 week') AS weeks(start) LEFT JOIN milk_collections m ON m.date_received>=start::date AND m.date_received<(start+interval '1 week')::date GROUP BY start ORDER BY start`);
 const {rows:monthly}=await pool.query(`SELECT start::date::text AS label,coalesce(sum(m.quantity_liters),0)::text AS liters FROM generate_series(date_trunc('month',now() AT TIME ZONE 'Africa/Nairobi')-interval '11 months',date_trunc('month',now() AT TIME ZONE 'Africa/Nairobi'),interval '1 month') AS months(start) LEFT JOIN milk_collections m ON m.date_received>=start::date AND m.date_received<(start+interval '1 month')::date GROUP BY start ORDER BY start`);
 const {rows:categories}=await pool.query("SELECT coalesce(supplier_category_at_collection,'Awaiting Categorisation') AS category,sum(quantity_liters)::text AS liters,count(*)::int AS deliveries FROM milk_collections GROUP BY 1 ORDER BY 1");
 return {totals,daily,weekly,monthly,categories};
}

export async function milkDetail(pool,id){
 if(!uuid.test(id))throw new Problem(400,'Invalid collection identifier.');
 const {rows:[record]}=await pool.query(`SELECT m.id,m.collection_id,m.farmer_id,f.customer_id AS farmer_code,f.full_name AS farmer_name,m.supplier_category_at_collection AS category,m.quantity_liters::text,m.date_received::text,m.recorded_by,m.source_portal,m.created_at,m.updated_at::text AS revision FROM milk_collections m JOIN farmers f ON f.id=m.farmer_id WHERE m.id=$1`,[id]);
 if(!record)throw new Problem(404,'Milk collection not found.');
 const {rows:history}=await pool.query('SELECT previous_state,new_state,reason,actor,source_portal,changed_at FROM milk_collection_audit WHERE collection_id=$1 ORDER BY changed_at DESC,id DESC',[id]);
 return {...record,history};
}

export async function updateMilkCollection(client,id,input,actor,portal){
 if(!uuid.test(id))throw new Problem(400,'Invalid collection identifier.');
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Problem(400,'Invalid correction.');
 const reason=typeof input.reason==='string'?input.reason.trim():'';
 if(reason.length<5||reason.length>500)throw new Problem(400,'Enter a brief reason for the correction (5–500 characters).');
 if(!uuid.test(input.farmer_id||''))throw new Problem(400,'Select a farmer from the directory.');
 const quantity=String(input.quantity_liters??'');
 if(!quantityValid(quantity))throw new Problem(400,'Enter a positive quantity in liters with up to six decimal places.');
 if(!dateValid(input.date_received)||input.date_received>today())throw new Problem(400,'Choose today or an earlier valid delivery date.');
 const {rows:[old]}=await client.query(`SELECT m.*,m.quantity_liters::text AS quantity_text,m.date_received::text AS received_date,m.updated_at::text AS revision,f.customer_id AS farmer_code,f.full_name AS farmer_name FROM milk_collections m JOIN farmers f ON f.id=m.farmer_id WHERE m.id=$1 FOR UPDATE OF m`,[id]);
 if(!old)throw new Problem(404,'Milk collection not found.');
 if(input.revision!==old.revision)throw new Problem(409,'This collection changed. Reopen it before saving your correction.');
 const {rows:[farmer]}=await client.query('SELECT id,customer_id,full_name,category FROM farmers WHERE id=$1',[input.farmer_id]);
 if(!farmer)throw new Problem(404,'Farmer not found.');
 const previous={farmer_id:old.farmer_id,farmer_code:old.farmer_code,farmer_name:old.farmer_name,category:old.supplier_category_at_collection,quantity_liters:old.quantity_text,date_received:old.received_date};
 const updated={farmer_id:farmer.id,farmer_code:farmer.customer_id,farmer_name:farmer.full_name,category:farmer.id===old.farmer_id?old.supplier_category_at_collection:farmer.category,quantity_liters:quantity,date_received:input.date_received};
 if(previous.farmer_id===updated.farmer_id&&Number(previous.quantity_liters)===Number(updated.quantity_liters)&&previous.date_received===updated.date_received)throw new Problem(400,'Change at least one collection field before saving.');
 const {rows:[linked]}=await client.query('SELECT EXISTS(SELECT 1 FROM milk_quality_checks WHERE collection_id=$1) OR EXISTS(SELECT 1 FROM milk_batch_allocations WHERE collection_id=$1) AS has_downstream',[id]);
 if(linked.has_downstream&&(old.farmer_id!==updated.farmer_id||Number(old.quantity_text)!==Number(updated.quantity_liters)))throw new Problem(409,'This collection has quality or processing records. An administrator must reconcile the downstream records before changing its farmer or quantity.');
 const {rows:[saved]}=await client.query('UPDATE milk_collections SET farmer_id=$2,supplier_category_at_collection=$3,quantity_liters=$4,date_received=$5,updated_at=now() WHERE id=$1 RETURNING id,collection_id,updated_at::text AS revision',[id,updated.farmer_id,updated.category,updated.quantity_liters,updated.date_received]);
 await client.query('INSERT INTO milk_collection_audit(collection_id,previous_state,new_state,reason,actor,source_portal) VALUES($1,$2,$3,$4,$5,$6)',[id,JSON.stringify(previous),JSON.stringify(updated),reason,actor,portal]);
 return saved;
}

export async function milkPhoto(pool,id){
 if(!uuid.test(id))throw new Problem(400,'Invalid collection identifier.');
 const {rows:[photo]}=await pool.query('SELECT content_type,image_data FROM milk_collection_photos WHERE collection_id=$1',[id]);
 if(!photo)throw new Problem(404,'Collection photograph not found.');return photo;
}

export async function farmerMilkHistory(pool,id){
 if(!uuid.test(id))throw new Problem(400,'Invalid farmer identifier.');
 const {rows:[farmer]}=await pool.query('SELECT 1 FROM farmers WHERE id=$1',[id]);if(!farmer)throw new Problem(404,'Farmer not found.');
 const {rows:[totals]}=await pool.query('SELECT count(*)::int AS deliveries,coalesce(sum(quantity_liters),0)::text AS total_liters,max(date_received)::text AS latest_date FROM milk_collections WHERE farmer_id=$1',[id]);
 const {rows:records}=await pool.query('SELECT id,collection_id,date_received::text,quantity_liters::text,supplier_category_at_collection AS category FROM milk_collections WHERE farmer_id=$1 ORDER BY date_received DESC,created_at DESC,id DESC LIMIT 50',[id]);
 return {totals,records};
}

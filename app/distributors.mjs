import {Problem} from './store.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sorts={distributor_code:'substring(d.distributor_code from 2)::bigint',name:'lower(d.name)',record_type:'d.record_type',route_name:'lower(d.route_name)',phone_number:'d.phone_number'};
const fields=['name','route_name','manager_name','phone_number','location'];
export async function listDistributors(pool,params){
 const q=(params.get('q')||'').trim().toLowerCase().slice(0,150),type=params.get('type')||'',parent=params.get('parent')||'';
 const sort=params.get('sort')||'distributor_code',direction=params.get('direction')||'asc';
 if(!Object.hasOwn(sorts,sort)||!['asc','desc'].includes(direction))throw new Problem(400,'Invalid distributor sorting.');
 if(type&&!['store','distributor'].includes(type))throw new Problem(400,'Invalid distributor type.');
 const page=Math.max(1,Math.min(100000,Number.parseInt(params.get('page')||'1',10)||1)),size=30;
 const clauses=[],values=[];
 if(q){values.push('%'+q.replace(/[\\%_]/g,'\\$&')+'%');clauses.push(`lower(d.distributor_code||' '||d.name||' '||coalesce(d.route_name,'')||' '||coalesce(d.manager_name,'')||' '||coalesce(d.phone_number,'')||' '||coalesce(p.name,'')) LIKE $${values.length} ESCAPE E'\\\\'`);}
 if(type){values.push(type);clauses.push(`d.record_type=$${values.length}`);}
 if(parent){if(!uuid.test(parent))throw new Problem(400,'Invalid parent distributor.');values.push(parent);clauses.push(`d.parent_id=$${values.length}`);}
 const join='FROM distributors d LEFT JOIN distributors p ON p.id=d.parent_id',where=clauses.length?'WHERE '+clauses.join(' AND '):'';
 const {rows:[total]}=await pool.query(`SELECT count(*)::int AS count ${join} ${where}`,values);
 const {rows:[stats]}=await pool.query("SELECT count(*) FILTER (WHERE record_type='distributor')::int AS distributors,count(*) FILTER (WHERE record_type='store')::int AS stores,(SELECT count(*)::int FROM customers) AS customers FROM distributors");
 const {rows:[activity]}=await pool.query("SELECT count(*)::int AS records,coalesce(sum(d.quantity_liters) FILTER (WHERE d.status IN ('dispatched','delivered') AND d.recipient_type='distributor'),0)::numeric(16,6)::text AS store_liters,coalesce(sum(d.quantity_liters) FILTER (WHERE d.status IN ('dispatched','delivered') AND d.recipient_type='customer'),0)::numeric(16,6)::text AS customer_liters FROM milk_distributions d");
 const {rows}=await pool.query(`SELECT d.id,d.distributor_code,d.name,d.record_type,d.parent_id,p.name AS parent_name,d.route_name,d.manager_name,d.phone_number,d.location ${join} ${where} ORDER BY ${sorts[sort]} ${direction} NULLS LAST,d.distributor_code ASC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,size,(page-1)*size]);
 return {records:rows,stats:{...stats,...activity},pagination:{page,page_size:size,total:total.count,total_pages:Math.max(1,Math.ceil(total.count/size))}};
}
export async function distributorDetail(pool,distributorId){
 if(!uuid.test(distributorId||''))throw new Problem(400,'Invalid distributor identifier.');
 const {rows:[row]}=await pool.query('SELECT d.id,d.distributor_code,d.name,d.record_type,d.parent_id,p.name AS parent_name,d.route_name,d.manager_name,d.phone_number,d.location,d.updated_at::text AS revision FROM distributors d LEFT JOIN distributors p ON p.id=d.parent_id WHERE d.id=$1',[distributorId]);
 if(!row)throw new Problem(404,'Distributor not found.');return row;
}
export async function updateDistributor(client,distributorId,input,actor){
 if(!uuid.test(distributorId||''))throw new Problem(400,'Invalid distributor identifier.');
 const {rows:[old]}=await client.query('SELECT *,updated_at::text AS revision FROM distributors WHERE id=$1 FOR UPDATE',[distributorId]);
 if(!old)throw new Problem(404,'Distributor not found.');
 if(input.revision!==old.revision)throw new Problem(409,'This record changed. Reload before saving.');
 const data={};for(const key of fields){const value=input[key];if(value!=null&&typeof value!=='string')throw new Problem(400,'Invalid distributor field.');data[key]=value?.trim()||null;if(data[key]?.length>300)throw new Problem(400,'Distributor field is too long.');}
 if(!data.name)throw new Problem(400,'Enter a distributor or store name.');
 const {rows:[saved]}=await client.query('UPDATE distributors SET name=$2,route_name=$3,manager_name=$4,phone_number=$5,location=$6,updated_at=now() WHERE id=$1 RETURNING id,updated_at::text AS revision',[distributorId,...fields.map(key=>data[key])]);
 await client.query('INSERT INTO distributor_audit(distributor_id,previous_state,new_state,actor) VALUES($1,$2,$3,$4)',[distributorId,JSON.stringify(Object.fromEntries(fields.map(key=>[key,old[key]]))),JSON.stringify(data),actor]);
 return saved;
}
export async function distributorAudit(pool,distributorId){
 if(!uuid.test(distributorId||''))throw new Problem(400,'Invalid distributor identifier.');
 const {rows}=await pool.query('SELECT previous_state,new_state,actor,changed_at FROM distributor_audit WHERE distributor_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 100',[distributorId]);
 return rows;
}

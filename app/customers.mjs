import {customerCountQuery} from './master-data.mjs';
import {Problem} from './store.mjs';

export const customerCategories=['Current Customers','Lapsed Customers (Expected to Resume Soon)','Geographically Isolated','Dormant / Non-Responsive','Retired'];
export const customerCategoryRoutes={current:'Current Customers',lapsed:'Lapsed Customers (Expected to Resume Soon)','geographically-isolated':'Geographically Isolated',dormant:'Dormant / Non-Responsive',retired:'Retired'};
const sorts={customer_id:"substring(customer_id from 2)::bigint",full_name:'lower(full_name)',physical_address:'lower(physical_address)',phone_number:'phone_number',gender:'gender',category:'category'};
const genderFilters=new Set(['male','female','not_verified','suggested']);
const fields=['full_name','physical_address','phone_number','category','gender'];
const editable=row=>Object.fromEntries(fields.map(key=>[key,row[key]]));
function clean(value,label,max=300){if(value==null)return null;if(typeof value!=='string')throw new Problem(400,`Invalid ${label}.`);const out=value.trim();if(out.length>max)throw new Problem(400,`${label} is too long.`);return out||null;}
function validateGender(value){if(value!==null&&value!==''&&value!=='male'&&value!=='female')throw new Problem(400,'Gender must be male, female or not verified.');return value||null;}
function validateCategory(value){if(value!==null&&!customerCategories.includes(value))throw new Problem(400,'Invalid customer category.');return value;}

export async function listCustomers(pool,params){
 const q=(params.get('q')||'').trim().toLowerCase().slice(0,150),sort=params.get('sort')||'customer_id',direction=params.get('direction')||'asc';
 if(!Object.hasOwn(sorts,sort)||!['asc','desc'].includes(direction))throw new Problem(400,'Invalid customer sorting.');
 const category=params.get('category')||'',genderStatus=params.get('gender_status')||'';
 if(category&&!customerCategories.includes(category)&&category!=='unassigned')throw new Problem(400,'Invalid customer category.');
 if(genderStatus&&!genderFilters.has(genderStatus))throw new Problem(400,'Invalid gender filter.');
 const page=Math.max(1,Math.min(100000,Number.parseInt(params.get('page')||'1',10)||1)),clauses=[],values=[];
 if(q){values.push('%'+q.replace(/[\\%_]/g,'\\$&')+'%');clauses.push(`lower(coalesce(customer_id,'')||' '||full_name||' '||coalesce(category,'Awaiting Categorisation')||' '||coalesce(physical_address,'')||' '||coalesce(phone_number,'')||' '||coalesce(gender,'Not specified')) LIKE $${values.length} ESCAPE E'\\\\'`);}
 if(category)clauses.push(category==='unassigned'?'category IS NULL':(values.push(category),`category=$${values.length}`));
 if(genderStatus==='male'||genderStatus==='female'){values.push(genderStatus);clauses.push(`gender=$${values.length}`);} else if(genderStatus==='not_verified')clauses.push('gender IS NULL'); else if(genderStatus==='suggested')clauses.push("suggested_gender IS NOT NULL AND gender_suggestion_status='pending_review'");
 const size=30,where=clauses.length?'WHERE '+clauses.join(' AND '):'';
 const {rows:[count]}=await pool.query(`SELECT count(*)::int AS total FROM customers ${where}`,values);
 const {rows:[all]}=await pool.query(customerCountQuery);
 const {rows:groups}=await pool.query('SELECT category,count(*)::int AS total FROM customers GROUP BY category');
 const categories=Object.fromEntries(customerCategories.map(label=>[label,groups.find(row=>row.category===label)?.total||0]));
 const {rows}=await pool.query(`SELECT id,customer_id,full_name,physical_address,phone_number,gender,category,updated_at::text AS revision,suggested_gender,gender_suggestion_status,gender_suggestion_source,gender_suggestion_reason FROM customers ${where} ORDER BY ${sorts[sort]} ${direction} NULLS LAST,substring(customer_id from 2)::bigint ASC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,size,(page-1)*size]);
 return {customers:rows,total:all.total,stats:{categories,uncategorized:groups.find(row=>row.category===null)?.total||0},pagination:{page,page_size:size,total:count.total,total_pages:Math.max(1,Math.ceil(count.total/size))}};
}
export async function customerDetail(pool,id){const {rows:[customer]}=await pool.query('SELECT id,customer_id,full_name,physical_address,phone_number,gender,category,updated_at::text AS revision,suggested_gender,gender_suggestion_status,gender_suggestion_source,gender_suggestion_reason,gender_reviewed_at::text AS gender_reviewed_at FROM customers WHERE id=$1',[id]);if(!customer)throw new Problem(404,'Customer not found.');return customer;}
async function locked(client,id){const {rows:[row]}=await client.query('SELECT *,updated_at::text AS revision FROM customers WHERE id=$1 FOR UPDATE',[id]);if(!row)throw new Problem(404,'Customer not found.');return row;}
async function audit(client,id,old,next,actor){await client.query('INSERT INTO customer_audit(customer_id,previous_state,new_state,actor) VALUES($1,$2,$3,$4)',[id,JSON.stringify(old),JSON.stringify(next),actor]);}
export async function updateCustomer(client,id,input,actor){
 const old=await locked(client,id);if(input.revision!==old.revision)throw new Problem(409,'This record changed. Reload before saving.');
 const data={full_name:clean(input.full_name,'Customer name'),physical_address:clean(input.physical_address,'Physical address'),phone_number:clean(input.phone_number,'Phone number',80),category:validateCategory(input.category??null),gender:validateGender(input.gender??null)};if(!data.full_name)throw new Problem(400,'Enter a customer name.');
 let source=old.gender_source||null,verifiedAt=old.gender_verified_at||null;if(data.gender!==old.gender){if(data.gender){if(!['manual_confirmation','source_document'].includes(input.gender_source))throw new Problem(400,'Verified gender requires an administrator confirmation source.');source=input.gender_source;verifiedAt=new Date().toISOString();}else{source=null;verifiedAt=null;}}
 const {rows:[saved]}=await client.query('UPDATE customers SET full_name=$2,physical_address=$3,phone_number=$4,category=$5,gender=$6,gender_source=$7,gender_verified_at=$8 WHERE id=$1 RETURNING id,customer_id,updated_at::text AS revision,suggested_gender,gender_suggestion_status',[id,data.full_name,data.physical_address,data.phone_number,data.category,data.gender,source,verifiedAt]);
 await audit(client,id,editable(old),{...data,gender_source:source,gender_verified_at:verifiedAt},actor);return saved;
}
export async function reviewCustomerGender(client,id,input,actor){
 const old=await locked(client,id),action=input.action;if(!['accept','reject','not_verified'].includes(action))throw new Problem(400,'Invalid gender review action.');if(action==='accept'&&!['male','female'].includes(old.suggested_gender))throw new Problem(400,'There is no gender suggestion to accept.');
 const gender=action==='accept'?old.suggested_gender:null,status=action==='accept'?'accepted':action==='reject'?'rejected':'not_reviewed';const {rows:[saved]}=await client.query("UPDATE customers SET gender=$2,gender_source=$3,gender_verified_at=$4,gender_suggestion_status=$5,gender_reviewed_at=now() WHERE id=$1 RETURNING id,customer_id,gender,gender_suggestion_status,updated_at::text AS revision",[id,gender,gender?'manual_confirmation':null,gender?new Date().toISOString():null,status]);await audit(client,id,editable(old),{gender,gender_source:gender?'manual_confirmation':null,gender_suggestion_status:status},actor);return saved;
}
export async function bulkReviewCustomerGender(client,ids,action,actor){if(!Array.isArray(ids)||ids.length<1||ids.length>200)throw new Problem(400,'Select between 1 and 200 customers.');const results=[];for(const id of ids)results.push(await reviewCustomerGender(client,id,{action},actor));return {updated:results.length,customers:results};}

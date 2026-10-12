import {Problem} from './store.mjs';

export const customerCategories=['Current Customers','Lapsed Customers (Expected to Resume Soon)','Geographically Isolated','Dormant / Non-Responsive','Retired'];
export const customerCategoryRoutes={current:'Current Customers',lapsed:'Lapsed Customers (Expected to Resume Soon)','geographically-isolated':'Geographically Isolated',dormant:'Dormant / Non-Responsive',retired:'Retired'};
const sorts={customer_id:"substring(customer_id from 2)::bigint",full_name:'lower(full_name)',physical_address:'lower(physical_address)',phone_number:'phone_number',gender:'gender',category:'category'};

export async function listCustomers(pool,params){
 const q=(params.get('q')||'').trim().toLowerCase().slice(0,150);
 const sort=params.get('sort')||'customer_id',direction=params.get('direction')||'asc';
 if(!Object.hasOwn(sorts,sort)||!['asc','desc'].includes(direction))throw new Problem(400,'Invalid customer sorting.');
 const category=params.get('category')||'';
 if(category&&!customerCategories.includes(category)&&category!=='unassigned')throw new Problem(400,'Invalid customer category.');
 const page=Math.max(1,Math.min(100000,Number.parseInt(params.get('page')||'1',10)||1));
 const clauses=[],values=[];
 if(q){values.push('%'+q.replace(/[\\%_]/g,'\\$&')+'%');clauses.push(`lower(coalesce(customer_id,'')||' '||full_name||' '||coalesce(category,'Awaiting Categorisation')||' '||coalesce(physical_address,'')||' '||coalesce(phone_number,'')||' '||coalesce(gender,'Not specified')) LIKE $${values.length} ESCAPE E'\\\\'`);}
 if(category)clauses.push(category==='unassigned'?'category IS NULL':(values.push(category),`category=$${values.length}`));
 const size=30,where=clauses.length?'WHERE '+clauses.join(' AND '):'';
 const {rows:[count]}=await pool.query(`SELECT count(*)::int AS total FROM customers ${where}`,values);
 const {rows:[all]}=await pool.query('SELECT count(*)::int AS total FROM customers');
 const {rows:groups}=await pool.query('SELECT category,count(*)::int AS total FROM customers GROUP BY category');
 const categories=Object.fromEntries(customerCategories.map(label=>[label,groups.find(row=>row.category===label)?.total||0]));
 const {rows}=await pool.query(`SELECT id,customer_id,full_name,physical_address,phone_number,gender,category FROM customers ${where} ORDER BY ${sorts[sort]} ${direction} NULLS LAST,substring(customer_id from 2)::bigint ASC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,size,(page-1)*size]);
 return {customers:rows,total:all.total,stats:{categories,uncategorized:groups.find(row=>row.category===null)?.total||0},pagination:{page,page_size:size,total:count.total,total_pages:Math.max(1,Math.ceil(count.total/size))}};
}

export async function customerDetail(pool,id){
 const {rows:[customer]}=await pool.query('SELECT id,customer_id,full_name,physical_address,phone_number,gender,category FROM customers WHERE id=$1',[id]);
 if(!customer)throw new Problem(404,'Customer not found.');
 return customer;
}

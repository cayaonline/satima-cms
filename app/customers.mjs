import {Problem} from './store.mjs';

const sorts={customer_id:"substring(customer_id from 2)::bigint",full_name:'lower(full_name)',physical_address:'lower(physical_address)',phone_number:'phone_number',gender:'gender'};

export async function listCustomers(pool,params){
 const q=(params.get('q')||'').trim().toLowerCase().slice(0,150);
 const sort=params.get('sort')||'customer_id',direction=params.get('direction')||'asc';
 if(!Object.hasOwn(sorts,sort)||!['asc','desc'].includes(direction))throw new Problem(400,'Invalid customer sorting.');
 const page=Math.max(1,Math.min(100000,Number.parseInt(params.get('page')||'1',10)||1));
 const size=30,where=q?`WHERE lower(coalesce(customer_id,'')||' '||full_name||' '||coalesce(physical_address,'')||' '||coalesce(phone_number,'')||' '||coalesce(gender,'Not specified')) LIKE $1 ESCAPE E'\\\\'`:'';
 const values=q?['%'+q.replace(/[\\%_]/g,'\\$&')+'%']:[];
 const {rows:[count]}=await pool.query(`SELECT count(*)::int AS total FROM customers ${where}`,values);
 const {rows:[all]}=await pool.query('SELECT count(*)::int AS total FROM customers');
 const {rows}=await pool.query(`SELECT id,customer_id,full_name,physical_address,phone_number,gender FROM customers ${where} ORDER BY ${sorts[sort]} ${direction} NULLS LAST,substring(customer_id from 2)::bigint ASC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,size,(page-1)*size]);
 return {customers:rows,total:all.total,pagination:{page,page_size:size,total:count.total,total_pages:Math.max(1,Math.ceil(count.total/size))}};
}

export async function customerDetail(pool,id){
 const {rows:[customer]}=await pool.query('SELECT id,customer_id,full_name,physical_address,phone_number,gender FROM customers WHERE id=$1',[id]);
 if(!customer)throw new Problem(404,'Customer not found.');
 return customer;
}

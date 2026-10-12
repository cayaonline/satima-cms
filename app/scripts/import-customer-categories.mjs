// Apply a privately reviewed category reconciliation to existing customer IDs.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {customerCategories} from '../customers.mjs';

const [planPath,workbookPath,mode='check']=process.argv.slice(2);
if(!planPath||!workbookPath)throw new Error('Provide the private category plan and original workbook.');
const plan=JSON.parse(await readFile(planPath,'utf8'));
const checksum=createHash('sha256').update(await readFile(workbookPath)).digest('hex');
assert.equal(plan.document_sha256,checksum,'Workbook changed after reconciliation.');
assert.equal(plan.customers.length,230,'Category plan must account for every existing customer.');
const ids=new Set(),rows=new Set();
for(const item of plan.customers){
 assert(/^C\d{4}$/.test(item.customer_id)&&!ids.has(item.customer_id),'Duplicate or invalid Customer ID.');
 assert(item.category===null||customerCategories.includes(item.category),'Unknown category.');
 assert(Array.isArray(item.source_rows)&&item.source_rows.length>0,'Missing source rows.');
 ids.add(item.customer_id);
 for(const row of item.source_rows){assert(Number.isInteger(row)&&row>2&&!rows.has(row),'Duplicate source row.');rows.add(row);}
}
assert.equal(rows.size,plan.source_rows,'Source row count changed.');
const counts=Object.fromEntries([...customerCategories,null].map(category=>[category??'Awaiting Categorisation',plan.customers.filter(item=>item.category===category).length]));
if(mode!=='apply'){console.log(JSON.stringify({valid:true,customers:ids.size,source_rows:rows.size,counts}));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw new Error('Owner database connection required.');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=120000'});
await db.connect();
try{
 await db.query('BEGIN');
 await db.query('SELECT pg_advisory_xact_lock(728410025)');
 const {rows:existing}=await db.query('SELECT customer_id,category FROM customers ORDER BY customer_id');
 assert.equal(existing.length,plan.customers.length,'Database customer count differs from reviewed plan.');
 const {rows:links}=await db.query('SELECT c.customer_id,s.row_number FROM customer_source_rows s JOIN customers c ON c.id=s.customer_id WHERE s.document_sha256=$1 ORDER BY c.customer_id,s.row_number',[checksum]);
 assert.equal(links.length,rows.size,'Database source row count differs from reviewed plan.');
 const dbRows=new Map();for(const link of links){if(!dbRows.has(link.customer_id))dbRows.set(link.customer_id,[]);dbRows.get(link.customer_id).push(link.row_number);}
 const byId=new Map(existing.map(item=>[item.customer_id,item]));
 for(const item of plan.customers){
  assert(byId.has(item.customer_id),'Customer ID missing from database.');
  assert.deepEqual(dbRows.get(item.customer_id),[...item.source_rows].sort((a,b)=>a-b),'Customer source row match changed.');
  assert(byId.get(item.customer_id).category===null||byId.get(item.customer_id).category===item.category,'Existing category differs from reviewed plan.');
 }
 for(const item of plan.customers)await db.query('UPDATE customers SET category=$2 WHERE customer_id=$1',[item.customer_id,item.category]);
 await db.query('COMMIT');console.log(JSON.stringify({updated:plan.customers.length,counts}));
}catch(error){await db.query('ROLLBACK');console.error('Customer category update rolled back:',error.code||error.message);process.exitCode=1;}
finally{await db.end();}

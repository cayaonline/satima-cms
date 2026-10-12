// Import a privately reviewed customer plan. The source workbook and plan stay outside Git.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const [planPath,workbookPath,mode='check']=process.argv.slice(2);
if(!planPath||!workbookPath)throw new Error('Provide a private customer plan and source workbook.');
const plan=JSON.parse(await readFile(planPath,'utf8'));
assert.equal(plan.document_sha256,createHash('sha256').update(await readFile(workbookPath)).digest('hex'),'Workbook changed after review.');
assert(Array.isArray(plan.customers)&&plan.customers.length>0&&Number.isInteger(plan.source_rows),'Invalid customer plan.');
const seen=new Set();
for(const customer of plan.customers){
 assert(typeof customer.full_name==='string'&&customer.full_name.trim()&&customer.full_name.length<=300,'Invalid customer name.');
 assert(customer.gender===null||['male','female'].includes(customer.gender),'Gender requires explicit source evidence.');
 assert(customer.physical_address==null||typeof customer.physical_address==='string'&&customer.physical_address.length<=1000,'Invalid address.');
 assert(customer.phone_number==null||/^0\d{9}$/.test(customer.phone_number),'Invalid phone.');
 assert(Array.isArray(customer.source_rows)&&customer.source_rows.length>0,'Missing source row.');
 for(const row of customer.source_rows){assert(Number.isInteger(row)&&row>2&&!seen.has(row),'Duplicate source row.');seen.add(row);}
}
assert.equal(seen.size,plan.source_rows,'Missing customer source row.');
if(mode!=='apply'){console.log(JSON.stringify({valid:true,source_rows:seen.size,customers:plan.customers.length}));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw new Error('Owner database connection required.');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=120000'});
await db.connect();
try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(728410024)');
 const {rows:[prior]}=await db.query('SELECT count(*)::int AS n FROM customer_source_rows WHERE document_sha256=$1',[plan.document_sha256]);
 if(prior.n){assert.equal(prior.n,seen.size,'Incomplete prior import.');await db.query('ROLLBACK');console.log('Workbook already imported.');process.exit(0);}
 const {rows:[existing]}=await db.query('SELECT count(*)::int AS n FROM customers');
 assert.equal(existing.n,0,'Existing customers require a separate reconciliation.');
 for(const item of plan.customers){
  const {rows:[customer]}=await db.query('INSERT INTO customers(full_name,physical_address,phone_number,gender,source_sha256) VALUES($1,$2,$3,$4,$5) RETURNING id',[item.full_name,item.physical_address,item.phone_number,item.gender,plan.document_sha256]);
  for(const row of item.source_rows)await db.query('INSERT INTO customer_source_rows(document_sha256,sheet_name,row_number,customer_id) VALUES($1,$2,$3,$4)',[plan.document_sha256,plan.sheet_name,row,customer.id]);
 }
 await db.query('COMMIT');console.log(JSON.stringify({imported:plan.customers.length,source_rows:seen.size}));
}catch(error){await db.query('ROLLBACK');console.error('Customer import rolled back:',error.code||error.message);process.exitCode=1;}
finally{await db.end();}

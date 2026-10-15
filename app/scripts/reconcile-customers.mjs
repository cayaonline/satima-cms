// Apply only exact, privately reviewed source matches and unambiguous additions.
// The workbook and detailed plan remain outside the public repository.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const [planPath,workbookPath,mode='check']=process.argv.slice(2);
if(!planPath||!workbookPath)throw new Error('Provide a private reconciliation plan and original workbook.');
const plan=JSON.parse(await readFile(planPath,'utf8'));
assert.equal(plan.document_sha256,createHash('sha256').update(await readFile(workbookPath)).digest('hex'),'Workbook changed since review.');
assert(Array.isArray(plan.records)&&plan.records.length===plan.expected_rows&&Array.isArray(plan.matched_before),'Invalid reconciliation plan.');
const seen=new Set(),ids=new Set();
for(const row of plan.records){
 assert(Number.isInteger(row.row)&&row.row>1&&!seen.has(row.row),'Repeated or invalid source row.');seen.add(row.row);
 assert(['matched','new','review'].includes(row.action),'Invalid action.');
 assert(typeof row.name==='string'&&row.name.trim()&&row.name.length<=300,'Invalid customer name.');
 assert(row.phone_number===null||/^0\d{9}$/.test(row.phone_number),'Invalid source phone.');
 if(row.action==='matched'){assert(row.customer_id&&!ids.has(row.customer_id),'Repeated match.');ids.add(row.customer_id);}
 else assert(!row.customer_id,'Unconfirmed match cannot update an existing customer.');
}
const expectedLinks=plan.records.filter(row=>row.action!=='review').length;
if(mode!=='apply'){console.log(JSON.stringify({valid:true,source_rows:seen.size,matched:ids.size,additions:plan.records.filter(r=>r.action==='new').length,review:seen.size-expectedLinks}));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw new Error('Owner database connection required.');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=120000'});await db.connect();
try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(728410027)');
 const {rows:[prior]}=await db.query('SELECT count(*)::int AS n FROM customer_source_rows WHERE document_sha256=$1',[plan.document_sha256]);
 if(prior.n){assert.equal(prior.n,expectedLinks,'Incomplete prior reconciliation.');await db.query('ROLLBACK');console.log('Workbook already reconciled.');process.exit(0);}
 const {rows:[count]}=await db.query('SELECT count(*)::int AS n FROM customers');assert.equal(count.n,plan.expected_existing,'Customer count changed since review.');
 const before=new Map(plan.matched_before.map(row=>[row.id,row]));
 for(const row of plan.records.filter(row=>row.action==='matched')){
  const {rows:[live]}=await db.query('SELECT id,full_name,phone_number,physical_address,category FROM customers WHERE id=$1 FOR UPDATE',[row.customer_id]);
  assert.deepEqual(live,before.get(row.customer_id),'Matched customer changed since review.');
 }
 const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const {rows:existing}=await db.query('SELECT full_name,phone_number FROM customers');
 const names=new Set(existing.map(row=>normalize(row.full_name))),phones=new Set(existing.map(row=>String(row.phone_number||'').replace(/\D/g,'').slice(-9)).filter(Boolean));
 const report={matched:0,updated:0,added:0,review:0};
 for(const row of plan.records){
  if(row.action==='review'){report.review++;continue;}
  let id=row.customer_id;
  if(row.action==='matched'){
   const old=before.get(id);const changed=old.full_name!==row.name||old.physical_address!==row.physical_address||old.phone_number!==row.phone_number;
   if(changed){await db.query('UPDATE customers SET full_name=$2,physical_address=$3,phone_number=$4 WHERE id=$1',[id,row.name,row.physical_address,row.phone_number]);report.updated++;}
   report.matched++;
  }else{
   const normalized=normalize(row.name),last9=row.phone_number?.slice(-9);
   assert(!names.has(normalized),'A new customer name now exists.');
   assert(!last9||!phones.has(last9),'A new customer phone now exists.');
   id=(await db.query('INSERT INTO customers(full_name,physical_address,phone_number,gender,source_sha256,category) VALUES($1,$2,$3,NULL,$4,NULL) RETURNING id',[row.name,row.physical_address,row.phone_number,plan.document_sha256])).rows[0].id;
   names.add(normalized);if(last9)phones.add(last9);report.added++;
  }
  await db.query('INSERT INTO customer_source_rows(document_sha256,sheet_name,row_number,customer_id) VALUES($1,$2,$3,$4)',[plan.document_sha256,plan.sheet_name,row.row,id]);
 }
 await db.query('COMMIT');console.log(JSON.stringify(report));
}catch(error){await db.query('ROLLBACK');console.error('Customer reconciliation rolled back:',error.code||error.message);process.exitCode=1;}finally{await db.end();}

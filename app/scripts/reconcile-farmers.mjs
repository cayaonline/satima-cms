// Record exact farmer matches and unresolved source rows without changing uncertain identities.
// The confidential workbook and reviewed plan remain outside Git.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {farmerCategories} from '../store.mjs';

const [planPath,workbookPath,mode='check']=process.argv.slice(2);
if(!planPath||!workbookPath)throw new Error('Provide a private farmer plan and original workbook.');
const plan=JSON.parse(await readFile(planPath,'utf8'));
assert.equal(plan.document_sha256,createHash('sha256').update(await readFile(workbookPath)).digest('hex'),'Workbook changed since review.');
assert(Array.isArray(plan.rows)&&plan.rows.length===plan.expected_rows&&Array.isArray(plan.matched_before),'Invalid farmer plan.');
const seen=new Set(),ids=new Set();
for(const row of plan.rows){
 assert(Number.isInteger(row.row)&&row.row>2&&!seen.has(row.row),'Repeated or invalid source row.');seen.add(row.row);
 assert(typeof row.name==='string'&&row.name.trim()&&farmerCategories.includes(row.category),'Invalid source farmer or category.');
 assert(['matched','review'].includes(row.action),'Unreviewed action.');
 assert(row.gender===null||['male','female'].includes(row.gender),'Gender requires source evidence.');
 if(row.action==='matched'){assert(row.farmer_id&&!ids.has(row.farmer_id),'Repeated farmer match.');ids.add(row.farmer_id);}
 else assert(!row.farmer_id,'Uncertain source row cannot change a farmer.');
}
if(mode!=='apply'){console.log(JSON.stringify({valid:true,source_rows:seen.size,matched:ids.size,review:seen.size-ids.size,additions:0}));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw new Error('Owner database connection required.');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=120000'});await db.connect();
try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(728410028)');
 const {rows:[prior]}=await db.query('SELECT count(*)::int AS n FROM farmer_master_sources WHERE document_sha256=$1',[plan.document_sha256]);
 if(prior.n){assert.equal(prior.n,seen.size,'Incomplete prior reconciliation.');await db.query('ROLLBACK');console.log('Workbook already reconciled.');process.exit(0);}
 const {rows:[count]}=await db.query('SELECT count(*)::int AS n FROM farmers');assert.equal(count.n,plan.expected_existing,'Farmer count changed since review.');
 const before=new Map(plan.matched_before.map(row=>[row.id,row]));
 for(const row of plan.rows.filter(row=>row.action==='matched')){
  const {rows:[live]}=await db.query('SELECT id,full_name,primary_phone,category,gender,customer_id,master_list_status FROM farmers WHERE id=$1 FOR UPDATE',[row.farmer_id]);
  assert.deepEqual(live,before.get(row.farmer_id),'Matched farmer changed since review.');
 }
 const report={matched:0,updated:0,added:0,review:0};
 for(const row of plan.rows){
  if(row.action==='matched'){
   const old=before.get(row.farmer_id);
   if(row.category!==old.category||row.gender&&row.gender!==old.gender){
    if(row.gender&&row.gender!==old.gender)await db.query("UPDATE farmers SET category=$2,gender=$3,gender_source='supplier_document',gender_verified_at=now() WHERE id=$1",[row.farmer_id,row.category,row.gender]);
    else await db.query('UPDATE farmers SET category=$2 WHERE id=$1',[row.farmer_id,row.category]);
    report.updated++;
   }
   report.matched++;
  }else report.review++;
  await db.query(`INSERT INTO farmer_master_sources(document_sha256,document_name,sheet_name,row_number,source_name,source_phone,source_category,farmer_id,match_result,review_reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[plan.document_sha256,plan.document_name,plan.sheet_name,row.row,row.name,row.phone,row.category,row.farmer_id,row.action==='matched'?'matched':'review_required',row.reason]);
 }
 await db.query('COMMIT');console.log(JSON.stringify(report));
}catch(error){await db.query('ROLLBACK');console.error('Farmer reconciliation rolled back:',error.code||error.message);process.exitCode=1;}finally{await db.end();}

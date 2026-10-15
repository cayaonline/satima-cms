// Apply a privately reviewed PDF reconciliation. The source PDF and plan stay outside Git.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {farmerCategories} from '../store.mjs';

const [planPath,pdfPath,mode='check']=process.argv.slice(2);
if(!planPath||!pdfPath)throw new Error('Provide a private reconciliation plan and source PDF.');
const plan=JSON.parse(await readFile(planPath,'utf8'));
const hash=createHash('sha256').update(await readFile(pdfPath)).digest('hex');
assert.equal(hash,plan.document_sha256,'Source PDF changed after review');
assert.equal(plan.source_rows,plan.rows.length,'Source row count changed');
const keys=new Set(),farmerIds=new Set();
for(const row of plan.rows){
 const key=`${row.page}:${row.row_number}`;
 assert(Number.isInteger(row.page)&&row.page>0&&Number.isInteger(row.row_number)&&row.row_number>0&&!keys.has(key),'Invalid or repeated source row');keys.add(key);
 assert(typeof row.name==='string'&&row.name.trim(),'Source name is missing');
 assert(farmerCategories.includes(row.category),'Unknown supplier category');
 assert(['male','female'].includes(row.gender),'Unknown source gender');
 assert(['matched','review_required','unmatched'].includes(row.result),'Unknown match result');
 assert(!row.review_candidates||row.result==='review_required'&&Array.isArray(row.review_candidates)&&row.review_candidates.every(id=>typeof id==='string'),'Invalid review candidates');
 if(row.result==='matched'){
  assert(typeof row.farmer_id==='string'&&!farmerIds.has(row.farmer_id),'Repeated farmer match');
  farmerIds.add(row.farmer_id);
  assert(row.before&&row.before.id===row.farmer_id,'Missing farmer snapshot');
 }else assert(!row.farmer_id,'Unreviewed source row cannot update a farmer');
}
const totals=plan.rows.reduce((acc,row)=>(acc[row.result]++,acc),{matched:0,review_required:0,unmatched:0});
if(mode!=='apply'){console.log(JSON.stringify({source_rows:plan.source_rows,...totals,applied:false}));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw new Error('Owner database connection required.');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=120000'});
await db.connect();
try{
 await db.query('BEGIN');
 await db.query('SELECT pg_advisory_xact_lock(728410023)');
 await db.query("SELECT set_config('app.actor','October supplier PDF reconciliation',true)");
 const {rows:[prior]}=await db.query('SELECT count(*)::int AS n FROM farmer_directory_sources WHERE document_sha256=$1',[hash]);
 if(prior.n){assert.equal(prior.n,totals.matched,'Partial source import detected');await db.query('ROLLBACK');console.log(JSON.stringify({source_rows:plan.source_rows,...totals,already_applied:true}));process.exit(0);}
 for(const row of plan.rows.filter(item=>item.result==='matched')){
  const {rows:[live]}=await db.query("SELECT id,full_name,primary_phone,category,gender,gender_source,registration_status,customer_id FROM farmers WHERE id=$1 AND record_kind='registered' FOR UPDATE",[row.farmer_id]);
  assert(live,'Farmer match disappeared');
  for(const field of ['full_name','primary_phone','category','gender','gender_source','registration_status','customer_id'])assert.equal(live[field],row.before[field],'Farmer changed since review');
  assert(live.gender==='not_verified'||live.gender===row.gender,'Gender conflicts with existing verified record');
  await db.query(`UPDATE farmers SET category=$2,gender=$3,
    gender_source=CASE WHEN gender='not_verified' THEN 'supplier_document' ELSE gender_source END,
    gender_verified_at=CASE WHEN gender='not_verified' THEN now() ELSE gender_verified_at END
    WHERE id=$1`,[row.farmer_id,row.category,row.gender]);
  await db.query(`INSERT INTO farmer_directory_sources
    (farmer_id,document_name,document_sha256,page_number,row_number,source_name,source_category,source_gender,match_result)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'matched')`,[row.farmer_id,plan.document_name,hash,row.page,row.row_number,row.name,row.category,row.gender]);
 }
 for(const row of plan.rows.filter(item=>item.result==='review_required')){
  for(const id of row.review_candidates||[]){
   const {rowCount}=await db.query("SELECT 1 FROM farmers WHERE id=$1 AND record_kind='registered'",[id]);
   assert.equal(rowCount,1,'Review candidate no longer exists');
   await db.query(`INSERT INTO farmer_data_issues(farmer_id,field_name,description,severity)
    VALUES($1,'supplier_pdf_match',$2,'review')`,[id,`Supplier PDF page ${row.page}, row ${row.row_number} has an uncertain identity match; review source before updating category or gender.`]);
  }
 }
 await db.query('COMMIT');console.log(JSON.stringify({source_rows:plan.source_rows,...totals,applied:true}));
}catch(error){await db.query('ROLLBACK');console.error('Supplier reconciliation rolled back:',error.code||error.name);process.exitCode=1;}
finally{await db.end();}

// Apply a privately reviewed XLSX reconciliation plan. The workbook and plan stay outside Git.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {farmerCategories} from '../store.mjs';

const [planPath,workbookPath,mode='check']=process.argv.slice(2);
if(!planPath||!workbookPath)throw new Error('Provide a private reconciliation plan and original workbook.');
const plan=JSON.parse(await readFile(planPath,'utf8'));
const hash=createHash('sha256').update(await readFile(workbookPath)).digest('hex');
assert.equal(plan.document_sha256,hash,'Workbook changed after review');
assert(Array.isArray(plan.rows)&&plan.rows.length>0&&Array.isArray(plan.existing),'Invalid plan');
const valid=['matched','added','review_required','non_farmer','unidentified'];
const seen=new Set(),matched=new Set();
for(const row of plan.rows){
 assert(Number.isInteger(row.row)&&row.row>1&&!seen.has(row.row),'Invalid or repeated row');seen.add(row.row);
 assert(typeof row.name==='string'&&row.name.trim(),'Missing source name');
 assert(farmerCategories.includes(row.category),'Invalid supplier category');
 assert(valid.includes(row.action),'Invalid reconciliation action');
 assert(row.action!=='matched'||row.farmer_id,'Match needs a farmer');
 assert(row.action!=='added'||!row.farmer_id,'New entry already has a farmer');
 if(row.action==='matched'){assert(!matched.has(row.farmer_id),'A farmer cannot match two source rows');matched.add(row.farmer_id);}
}
assert.equal(plan.rows.length,plan.expected_rows,'Unexpected supplier-list size');
if(mode!=='apply'){console.log(JSON.stringify({valid:true,source_rows:plan.rows.length,actions:plan.rows.reduce((a,r)=>(a[r.action]=(a[r.action]||0)+1,a),{})}));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw new Error('Owner database connection required.');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=120000'});
const phone=s=>String(s||'').replace(/\D/g,'').replace(/^254/,'0').replace(/^0(?=\d{9}$)/,'');
await db.connect();
try{
 await db.query('BEGIN');
 await db.query('SELECT pg_advisory_xact_lock(728410023)');
 await db.query("SELECT set_config('app.actor','October supplier master import',true)");
 const prior=await db.query('SELECT count(*)::int AS n FROM farmer_master_sources WHERE document_sha256=$1',[hash]);
 if(prior.rows[0].n){assert.equal(prior.rows[0].n,plan.rows.length,'Incomplete prior import');await db.query('ROLLBACK');console.log('Workbook already imported.');process.exit(0);}
 const live=(await db.query("SELECT id,full_name,primary_phone,category,registration_status,customer_id FROM farmers WHERE record_kind='registered' ORDER BY id FOR UPDATE")).rows;
 assert.equal(live.length,plan.existing.length,'Existing farmer count changed since review');
 const expected=new Map(plan.existing.map(f=>[f.id,f]));
 for(const farmer of live){
  const before=expected.get(farmer.id);
  assert(before&&before.full_name===farmer.full_name&&before.primary_phone===farmer.primary_phone&&before.category===farmer.category&&before.registration_status===farmer.registration_status&&before.customer_id===farmer.customer_id,'Farmer changed since review');
 }
 const known=new Set(live.map(f=>f.id));
 const matchedIds=new Set(plan.rows.filter(r=>r.action==='matched').map(r=>r.farmer_id));
 const reviewIds=new Set(plan.rows.flatMap(r=>r.candidate_ids||[]));
 for(const id of [...matchedIds,...reviewIds])assert(known.has(id),'Unknown match/review candidate');
 const report={matched:0,added:0,review_required:0,non_farmer:0,unidentified:0,historical:0,pending_review:0};
 for(const row of plan.rows){
  let farmerId=row.farmer_id||null;
  const sourcePhone=phone(row.phone);
  if(row.action==='matched'){
   const before=expected.get(farmerId);
   assert(before,'Unknown match');
   const existingPhone=phone(before.primary_phone);
   assert(!existingPhone||!sourcePhone||existingPhone===sourcePhone,'Conflicting phone on confirmed match');
   await db.query(`UPDATE farmers SET category=$2,master_list_status='current',
     primary_phone=CASE WHEN primary_phone IS NULL AND $3::text IS NOT NULL THEN $3 ELSE primary_phone END
     WHERE id=$1`,[farmerId,row.category,sourcePhone?'0'+sourcePhone:null]);
  }else if(row.action==='added'){
   assert(sourcePhone.length===9,'New farmer needs a valid unique phone');
   const duplicate=await db.query("SELECT 1 FROM farmers WHERE right(regexp_replace(coalesce(primary_phone,''),'[^0-9]','','g'),9)=$1",[sourcePhone]);
   assert(!duplicate.rowCount,'New farmer phone now exists');
   farmerId=(await db.query(`INSERT INTO farmers(customer_id,full_name,primary_phone,registered_by,registration_date,status,record_kind,registration_status,category,master_list_status)
      VALUES(NULL,$1,$2,NULL,NULL,'pending_verification','registered','not_registered',$3,'current') RETURNING id`,[row.name,'0'+sourcePhone,row.category])).rows[0].id;
  }
  await db.query(`INSERT INTO farmer_master_sources(document_sha256,document_name,sheet_name,row_number,source_name,source_phone,source_category,farmer_id,match_result,review_reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[hash,plan.document_name,plan.sheet_name,row.row,row.name,row.phone||null,row.category,farmerId,row.action,row.reason||null]);
  report[row.action]++;
  if(row.action==='review_required'){
   for(const id of row.candidate_ids||[]){
    await db.query('INSERT INTO farmer_data_issues(farmer_id,field_name,description,severity) VALUES($1,$2,$3,$4)',[id,'master_supplier_match',`Supplier master row ${row.row}: ${row.reason||'Identity requires manual verification.'}`,'review']);
   }
  }
 }
 for(const farmer of live){
  if(matchedIds.has(farmer.id))continue;
  const review=reviewIds.has(farmer.id);
  await db.query('UPDATE farmers SET master_list_status=$2 WHERE id=$1',[farmer.id,review?'pending_review':'historical']);
  if(review)report.pending_review++;
  else{
   report.historical++;
   await db.query('INSERT INTO farmer_data_issues(farmer_id,field_name,description,severity) VALUES($1,$2,$3,$4)',[farmer.id,'master_supplier_list','Existing farmer is absent from the current supplier master list; retain historical record and review.','review']);
  }
 }
 await db.query('COMMIT');console.log(JSON.stringify(report));
}catch(error){await db.query('ROLLBACK');console.error('Import rolled back:',error.code||error.message);process.exitCode=1;}
finally{await db.end();}

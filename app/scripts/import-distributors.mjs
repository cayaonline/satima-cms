// Import a privately reviewed plan. Neither the workbook nor plan belongs in Git.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const [planPath,workbookPath,mode='check']=process.argv.slice(2);
if(!planPath||!workbookPath)throw new Error('Provide a private distributor plan and source workbook.');
const plan=JSON.parse(await readFile(planPath,'utf8'));
assert.equal(plan.document_sha256,createHash('sha256').update(await readFile(workbookPath)).digest('hex'),'Workbook changed after review.');
assert(Array.isArray(plan.records)&&plan.records.length===plan.expected_rows&&plan.records.length>0,'Invalid distributor plan.');
const seen=new Set(),names=new Set();
for(const row of plan.records){
 assert(Number.isInteger(row.row)&&row.row>1&&!seen.has(row.row),'Duplicate source row.');seen.add(row.row);
 assert(typeof row.name==='string'&&row.name.trim()&&row.name.length<=300,'Invalid name.');
 assert(['distributor','store'].includes(row.record_type),'Invalid type.');
 const name=row.name.toLowerCase().replace(/[^a-z0-9]/g,'');assert(!names.has(name),'Duplicate normalized name.');names.add(name);
 if(row.parent_row!=null)assert(row.record_type==='store'&&Number.isInteger(row.parent_row)&&row.parent_row<row.row,'Invalid parent.');
 for(const field of ['route_name','manager_name','phone_number','location'])assert(row[field]==null||typeof row[field]==='string'&&row[field].length<=300,'Invalid field.');
}
assert(plan.records.every(row=>row.parent_row==null||plan.records.some(parent=>parent.row===row.parent_row&&parent.record_type==='distributor')),'Missing parent.');
if(mode!=='apply'){console.log(JSON.stringify({valid:true,source_rows:seen.size,distributors:plan.records.filter(r=>r.record_type==='distributor').length,stores:plan.records.filter(r=>r.record_type==='store').length}));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw new Error('Owner database connection required.');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=120000'});await db.connect();
try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(728410026)');
 const {rows:[prior]}=await db.query('SELECT count(*)::int AS n FROM distributor_source_rows WHERE document_sha256=$1',[plan.document_sha256]);
 if(prior.n){assert.equal(prior.n,seen.size,'Incomplete prior import.');await db.query('ROLLBACK');console.log('Workbook already imported.');process.exit(0);}
 const {rows:[existing]}=await db.query('SELECT count(*)::int AS n FROM distributors');assert.equal(existing.n,0,'Existing distributors require reconciliation.');
 const ids=new Map();
 for(const row of plan.records){
  const {rows:[saved]}=await db.query('INSERT INTO distributors(name,record_type,parent_id,route_name,manager_name,phone_number,location,source_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[row.name,row.record_type,row.parent_row==null?null:ids.get(row.parent_row),row.route_name,row.manager_name,row.phone_number,row.location,plan.document_sha256]);
  ids.set(row.row,saved.id);
  await db.query('INSERT INTO distributor_source_rows(document_sha256,sheet_name,row_number,distributor_id) VALUES($1,$2,$3,$4)',[plan.document_sha256,plan.sheet_name,row.row,saved.id]);
 }
 await db.query('COMMIT');console.log(JSON.stringify({imported:ids.size}));
}catch(error){await db.query('ROLLBACK');console.error('Distributor import rolled back:',error.code||error.message);process.exitCode=1;}finally{await db.end();}

import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const path=process.argv[2];if(!path)throw Error('Provide the private Naivas statement path.');
const bytes=await readFile(path),sha=createHash('sha256').update(bytes).digest('hex');
let data;try{data=JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./read-naivas-statement.py',import.meta.url)),path],{maxBuffer:4e6,stdio:['ignore','pipe','pipe']}));}catch{throw Error('Statement extraction failed; inspect privately.');}
if(process.argv.includes('--validate-only')){console.log(JSON.stringify({...data.summary,controls:data.controls,periodStart:data.periodStart,periodEnd:data.periodEnd,sourceSha256:sha}));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw Error('Private owner connection required.');
const client=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});
const id='naivas-statement-'+data.periodStart+'-'+data.periodEnd;
try{
 await client.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(728410041)');
 const {rows:[existing]}=await client.query('SELECT sha256,original_bytes FROM collections_source_files WHERE dataset_id=$1',[id]);
 if(existing){
  if(existing.sha256!==sha||createHash('sha256').update(existing.original_bytes).digest('hex')!==sha)throw Error('Existing source differs; use a reviewed new version.');
  const {rows:[check]}=await client.query('SELECT count(*)::int AS count,sum(amount)::text AS total FROM collections_retail_records WHERE dataset_id=$1',[id]);
  if(check.count!==data.records.length||Number(check.total)!==data.summary.listedInvoices)throw Error('Imported record validation mismatch.');
  await client.query('COMMIT');console.log('Identical immutable statement already imported; counts and total verified.');
 }else{
  await client.query("INSERT INTO collections_datasets(id,channel,kind,source_filename,source_sha256,classification_basis,reporting_month) VALUES($1,'distributors_stores','retailer_records','Naivas Oct Statement.xlsx',$2,'Supplied Naivas HQ customer statement; dates and anomalies retained. Statement period is distinct from individual invoice dates.',$3)",[id,sha,data.periodStart.slice(0,7)+'-01']);
  await client.query('INSERT INTO collections_source_files(dataset_id,filename,sha256,original_bytes) VALUES($1,$2,$3,$4)',[id,'Naivas Oct Statement.xlsx',sha,bytes]);
  const {records,sourceCells,...summary}=data;
  await client.query('INSERT INTO collections_retail_statements(dataset_id,retailer_code,period_start,period_end,payload) VALUES($1,\'naivas\',$2,$3,$4)',[id,data.periodStart,data.periodEnd,JSON.stringify(summary)]);
  const recordIds=new Map();
  for(const r of records){
   await client.query("INSERT INTO collections_retail_branches(retailer_code,branch_code,branch_name,source_reference) VALUES('naivas',$1,$1,$2) ON CONFLICT DO NOTHING",[r.branch,r.sourceReference]);
   const {rows:[saved]}=await client.query("INSERT INTO collections_retail_records(dataset_id,retailer_code,branch_code,kind,source_reference,document_reference,event_date,due_date,amount,source_row,purchase_order,raw_source,quality_flags) VALUES($1,'naivas',$2,'invoice',$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",[id,r.branch,r.sourceReference,r.invoice,r.date,r.dueDate,r.amount,r.row,r.purchaseOrder,JSON.stringify(r.raw),JSON.stringify(r.flags)]);recordIds.set(r.row,saved.id);
  }
  for(const e of data.exceptions)await client.query("INSERT INTO collections_retail_exceptions(retailer_code,record_id,description,source_reference,dataset_id,code,source_rows) VALUES('naivas',$1,$2,$3,$4,$5,$6)",[e.rows.length===1?recordIds.get(e.rows[0])||null:null,e.description,e.sourceReference,id,e.code,e.rows]);
  await client.query("UPDATE collections_retailers SET source_status='under_review' WHERE code='naivas'");
  await client.query('COMMIT');console.log('Imported immutable statement:',JSON.stringify(data.summary));
 }
}catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Naivas import failed:',error.code||error.message);process.exitCode=1;}finally{await client.end();}

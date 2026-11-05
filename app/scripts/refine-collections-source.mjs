import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const workbook=process.argv[2];
if(!workbook)throw new Error('Provide the original October workbook path.');
const bytes=await readFile(workbook),sha=createHash('sha256').update(bytes).digest('hex');
let data;
try{data=JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./read-collections-flags.py',import.meta.url)),workbook],{maxBuffer:2e6,stdio:['ignore','pipe','pipe']}));}
catch{throw new Error('Source flag extraction failed; inspect the workbook privately.');}
const flagged=data.records.filter(r=>r.sourceOverdue),summary={records:data.records.length,flaggedRows:flagged.map(r=>r.row),flaggedCount:flagged.length,flaggedBalance:flagged.reduce((n,r)=>n+Math.round(r.amount*100),0)/100};
if(process.argv.includes('--validate-only')){console.log(JSON.stringify(summary));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw new Error('Owner connection required in ADMIN_DATABASE_URL.');
const client=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});
try{
 await client.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(728410040)');
 const {rows:[snapshot]}=await client.query("SELECT workbook_sha256,payload FROM collections_october_snapshot WHERE id='october'");
 if(!snapshot||snapshot.workbook_sha256!==sha||snapshot.payload.records.length!==data.records.length)throw new Error('Source does not match the immutable snapshot.');
 const originals=new Map(snapshot.payload.records.map(r=>[r.row,r]));
 for(const row of data.records)if(originals.get(row.row)?.name!==row.name||originals.get(row.row)?.amount!==row.amount)throw new Error('Source row mismatch.');
 await client.query("INSERT INTO collections_datasets(id,channel,kind,source_filename,source_sha256,classification_basis) VALUES('october','home_customers','receivables_snapshot','Receivables October.xlsx',$1,'Owner clarification: Home Customers snapshot; invoice periods and dates unknown. Red cell fills identify source-flagged overdue accounts.') ON CONFLICT DO NOTHING",[sha]);
 const {rows:[dataset]}=await client.query("SELECT source_sha256,channel FROM collections_datasets WHERE id='october'");
 if(dataset.source_sha256!==sha||dataset.channel!=='home_customers')throw new Error('Dataset metadata mismatch.');
 for(const row of data.records){
  await client.query("INSERT INTO collections_home_accounts(dataset_id,source_row,source_overdue,style_evidence) VALUES('october',$1,$2,$3) ON CONFLICT DO NOTHING",[row.row,row.sourceOverdue,JSON.stringify(row.styleEvidence)]);
  const {rows:[stored]}=await client.query("SELECT source_overdue,style_evidence FROM collections_home_accounts WHERE dataset_id='october' AND source_row=$1",[row.row]);
  if(stored.source_overdue!==row.sourceOverdue||JSON.stringify(stored.style_evidence.map(e=>[e.cell,e.rgb,e.styleIndex,e.fillIndex]))!==JSON.stringify(row.styleEvidence.map(e=>[e.cell,e.rgb,e.styleIndex,e.fillIndex])))throw new Error('Existing flag evidence differs.');
 }
 await client.query('COMMIT');console.log('Verified source classification metadata:',JSON.stringify(summary));
}catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Classification import failed:',error.code||error.name);process.exitCode=1;}finally{await client.end();}

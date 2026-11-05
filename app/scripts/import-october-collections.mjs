// Owner-only import. No public upload or workbook download endpoint exists.
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {fileURLToPath} from 'node:url';
import {preparePresentation} from '../collections.mjs';

const [workbookPath,dashboardPath,mode]=process.argv.slice(2);
if(!workbookPath||!dashboardPath)throw new Error('Usage: node app/scripts/import-october-collections.mjs WORKBOOK DASHBOARD [--validate-only]');
const workbook=await readFile(workbookPath),dashboard=await readFile(dashboardPath);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const payload=JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./read-october-workbook.py',import.meta.url)),workbookPath],{maxBuffer:2e6,stdio:['ignore','pipe','pipe']}));
const presentation=preparePresentation(dashboard.toString('utf8'),payload.records);
const workbookHash=digest(workbook),dashboardHash=digest(dashboard);
if(mode==='--validate-only'){
 console.log(JSON.stringify({workbookSha256:workbookHash,dashboardSha256:dashboardHash,...payload.summary}));
}else{
 if(!process.env.ADMIN_DATABASE_URL)throw new Error('An owner connection is required in ADMIN_DATABASE_URL.');
 const client=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});
 try{
  await client.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(728410039)');
  const {rows:[existing]}=await client.query("SELECT workbook_sha256,dashboard_sha256 FROM collections_october_snapshot WHERE id='october'");
  if(existing){
   if(existing.workbook_sha256!==workbookHash||existing.dashboard_sha256!==dashboardHash)throw new Error('An immutable October import already exists with different source hashes.');
  }else{
   for(const [kind,name,bytes,sha] of [['workbook','Receivables October.xlsx',workbook,workbookHash],['dashboard','Satima_October_Receivables_Dashboard.html',dashboard,dashboardHash]]){
    await client.query('INSERT INTO collections_october_sources(kind,filename,sha256,original_bytes) VALUES($1,$2,$3,$4)',[kind,name,sha,bytes]);
   }
   await client.query('INSERT INTO collections_october_snapshot(id,workbook_sha256,dashboard_sha256,payload,presentation) VALUES($1,$2,$3,$4,$5)',['october',workbookHash,dashboardHash,payload,presentation]);
  }
  await client.query('COMMIT');console.log(existing?'Verified existing immutable October import.':'October sources and verified snapshot imported.');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('October import failed:',error.code||error.name);process.exitCode=1;}
 finally{await client.end();}
}

import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {insertInvoiceProjection} from '../collections-ledger.mjs';

const source=process.argv.at(-1), validateOnly=process.argv.includes('--validate-only');
const periods={'July Invoices.xls':'2026-07','August Invoices.xls':'2026-08','September Invoices.xls':'2026-09'};
if(!source||!periods[basename(source)])throw Error('Provide the supplied July, August, or September invoice workbook.');
const filename=basename(source),period=periods[filename],bytes=await readFile(source),sha=createHash('sha256').update(bytes).digest('hex'),dir=await mkdtemp(join(tmpdir(),'satima-invoices-'));
let payload;
try{
 const soffice=process.env.SOFFICE_BIN||'soffice';
 execFileSync(soffice,['--headless','--convert-to','xlsx','--outdir',dir,source],{stdio:'ignore',timeout:120000});
 const converted=join(dir,filename.replace(/\.xls$/i,'.xlsx'));
 payload=JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./read-monthly-invoices.py',import.meta.url)),converted,period],{maxBuffer:12e6,stdio:['ignore','pipe','pipe']}));
}catch{throw Error('Source validation failed. Ensure LibreOffice is available and inspect the workbook privately.');}
finally{await rm(dir,{recursive:true,force:true});}
if(validateOnly){console.log(JSON.stringify({...payload.summary,period,sourceFilename:filename,sha256:sha}));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw Error('Private owner connection required.');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL}),id=`sales-${period}`;
try{
 await db.connect();await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(728410042)');
 const {rows:[existing]}=await db.query('SELECT sha256 FROM collections_sales_evidence WHERE id=$1',[id]);
 if(existing){if(existing.sha256!==sha)throw Error('A different source is already archived for this month; a reviewed source revision is required.');}
 else{
  await db.query('INSERT INTO collections_sales_evidence(id,filename,sha256,original_bytes) VALUES($1,$2,$3,$4)',[id,filename,sha,bytes]);
  await db.query('INSERT INTO collections_sales_reports(id,reporting_month,payload) VALUES($1,$2,$3)',[id,`${period}-01`,payload]);
  await insertInvoiceProjection(db,id,period,payload);
 }
 await db.query('COMMIT');console.log(existing?'Identical source already archived.':'Monthly invoice source archived:',JSON.stringify({...payload.summary,period}));
}catch(e){await db.query('ROLLBACK').catch(()=>{});console.error('Monthly invoice import failed:',e.code||e.message);process.exitCode=1;}finally{await db.end();}

import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import pg from 'pg';
const path=process.argv[2];if(!path)throw Error('Provide the private October invoice workbook.');
const bytes=await readFile(path),sha=createHash('sha256').update(bytes).digest('hex');
let payload;try{payload=JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./read-october-invoices.py',import.meta.url)),path],{maxBuffer:4e6,stdio:['ignore','pipe','pipe']}));}catch{throw Error('Source validation failed.');}
if(process.argv.includes('--validate-only')){console.log(JSON.stringify({...payload.summary,sha256:sha}));process.exit(0);}
if(!process.env.ADMIN_DATABASE_URL)throw Error('Private owner connection required.');
const c=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});
try{await c.connect();await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(728410042)');const id='october-sales-2026';
 const {rows:[existing]}=await c.query('SELECT sha256 FROM collections_sales_evidence WHERE id=$1',[id]);
 if(existing){if(existing.sha256!==sha)throw Error('Different source requires a new reviewed version.');}
 else{await c.query('INSERT INTO collections_sales_evidence(id,filename,sha256,original_bytes) VALUES($1,$2,$3,$4)',[id,'October Invoices.xlsx',sha,bytes]);await c.query('INSERT INTO collections_sales_reports(id,reporting_month,payload) VALUES($1,$2,$3)',[id,'2026-10-01',payload]);}
 await c.query('COMMIT');console.log(existing?'Identical sales source already imported.':'Sales report imported:',JSON.stringify(payload.summary));
}catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('Sales import failed:',e.code||e.message);process.exitCode=1;}finally{await c.end();}

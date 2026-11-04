// Usage: node app/scripts/import-farmer-supply.mjs preview|apply source.csv original.xlsx [--actor=name]
// The CSV is a private normalized extract. The original workbook is hashed for provenance.
import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {importFarmerSupply,parseSupplyCsv} from '../farmer-supply.mjs';

const [mode,csvPath,workbookPath,...flags]=process.argv.slice(2);
if(!['preview','apply'].includes(mode)||!csvPath||!workbookPath)throw new Error('Usage: preview|apply source.csv original.xlsx [--actor=name]');
const options=Object.fromEntries(flags.map(flag=>{const m=flag.match(/^--([a-z-]+)=(.*)$/);if(!m)throw new Error('Invalid option');return [m[1],m[2]];}));
const csv=await readFile(csvPath),workbook=await readFile(workbookPath);const rows=parseSupplyCsv(csv.toString('utf8'));
const sourceHash=createHash('sha256').update(workbook).digest('hex');
const normalizedHash=createHash('sha256').update(csv).digest('hex');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=120000'});
try{await db.connect();const result=await importFarmerSupply(db,rows,{mode,sourceFilename:basename(workbookPath),sourceHash,normalizedHash,worksheet:'Table 1',actor:options.actor||'Satima administrator',revisionReason:options['revision-reason']||null});
 const {planned,...summary}=result;console.log(JSON.stringify({...summary,source_rows:rows.length,missing_values:rows.filter(r=>r.quantity_liters==='').length}));
 if(mode==='preview'){const {writeFile}=await import('node:fs/promises');await writeFile(options.plan||'/tmp/farmer-supply-plan.json',JSON.stringify({sourceHash,normalizedHash,sourceFilename:basename(workbookPath),rows:planned},null,2),{mode:0o600});}
}catch(error){console.error('Farmer supply import failed:',error.message);process.exitCode=1;}finally{await db.end();}

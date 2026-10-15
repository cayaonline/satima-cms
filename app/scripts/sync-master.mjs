// Usage: ADMIN_DATABASE_URL=... node app/scripts/sync-master.mjs preview farmers private.csv private-plan.json
//        ADMIN_DATABASE_URL=... node app/scripts/sync-master.mjs apply farmers private.csv private-plan.json
// Source files and plans contain personal data; store outside the public repository.
import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonicalRows,planSync,schema} from './master-sync-core.mjs';

const [mode,entity,sourcePath,planPath]=process.argv.slice(2);
if(!['preview','apply'].includes(mode)||!schema[entity]||!sourcePath||!planPath)throw new Error('Usage: sync-master.mjs preview|apply farmers|customers|distributors source.csv private-plan.json');
if(!process.env.ADMIN_DATABASE_URL)throw new Error('Owner database connection required.');
function csv(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){if(char==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(char==='"')quoted=false;else cell+=char;}
  else if(char==='"')quoted=true;
  else if(char===','){row.push(cell);cell='';}
  else if(char==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
  else cell+=char;
 }
 if(quoted)throw new Error('Unclosed CSV quote.');
 if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
 const headers=rows.shift()?.map((value,index)=>index===0?value.replace(/^\uFEFF/,'').trim():value.trim());
 if(!headers?.length||new Set(headers).size!==headers.length)throw new Error('Missing or repeated CSV columns.');
 return rows.filter(row=>row.some(value=>value.trim())).map((cells,index)=>{
  if(cells.length!==headers.length)throw new Error(`CSV column count differs on row ${index+2}.`);
  return Object.fromEntries(headers.map((key,col)=>[key,cells[col].trim()]).concat([['source_row',index+2]]));
 });
}
const raw=await readFile(sourcePath),sourceHash=createHash('sha256').update(raw).digest('hex');
let rows;
if(/\.xlsx$/i.test(sourcePath)){
 const parsed=spawnSync('python3',[fileURLToPath(new URL('./xlsx-rows.py',import.meta.url)),sourcePath],{encoding:'utf8',maxBuffer:50*1024*1024});
 if(parsed.status!==0)throw new Error(parsed.stderr.trim()||'Workbook could not be read.');
 rows=JSON.parse(parsed.stdout);
}else if(/\.csv$/i.test(sourcePath))rows=csv(raw.toString('utf8'));
else throw new Error('Use an .xlsx workbook or UTF-8 .csv file.');
rows=canonicalRows(entity,rows);
const spec=schema[entity];if(!rows.length)throw new Error('Source has no records.');
for(const key of [spec.name,spec.phone])if(!Object.hasOwn(rows[0],key))throw new Error(`Required CSV column: ${key}`);
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=120000'});
await db.connect();
let inTransaction=false;
try{
 if(mode==='apply'){
  await db.query('BEGIN');inTransaction=true;
  await db.query('SELECT pg_advisory_xact_lock(728410029)');
  await db.query(`LOCK TABLE ${spec.table} IN SHARE ROW EXCLUSIVE MODE`);
  const {rows:[prior]}=await db.query('SELECT id FROM master_sync_runs WHERE entity=$1 AND source_sha256=$2',[entity,sourceHash]);
  if(prior){await db.query('ROLLBACK');inTransaction=false;console.log('This source file was already synchronized.');process.exit(0);}
 }
 const {rows:existing}=await db.query(`SELECT ${spec.columns.join(',')} FROM ${spec.table}`);
 const plan=planSync(entity,rows,existing);
 const snapshot={entity,source_sha256:sourceHash,existing_count:existing.length,rows:plan};
 const planHash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
 if(mode==='preview'){
  await writeFile(planPath,JSON.stringify({...snapshot,plan_sha256:planHash},null,2),{flag:'wx',mode:0o600});
  const counts=Object.fromEntries(['updated','unchanged','added','review'].map(result=>[result,plan.filter(row=>row.result===result).length]));
  console.log(JSON.stringify({source_rows:rows.length,...counts,preview:planPath}));
  process.exit(0);
 }
 const reviewed=JSON.parse(await readFile(planPath,'utf8'));
 if(reviewed.entity!==entity||reviewed.source_sha256!==sourceHash||reviewed.plan_sha256!==planHash)throw new Error('Source or database changed since preview. Generate a fresh preview.');
 const {rows:[run]}=await db.query('INSERT INTO master_sync_runs(entity,source_sha256,plan_sha256,row_count) VALUES($1,$2,$3,$4) RETURNING id',[entity,sourceHash,planHash,plan.length]);
 const result={updated:0,unchanged:0,added:0,review:0};
 for(const item of plan){
  const source=item.source;let recordId=item.record_id;
  if(item.result==='updated'){
   const names=Object.keys(item.changes),values=names.map(name=>item.changes[name].to);
   const query=`UPDATE ${spec.table} SET ${names.map((name,index)=>`${name}=$${index+2}`).join(',')} WHERE id=$1`;
   const saved=await db.query(query,[recordId,...values]);if(saved.rowCount!==1)throw new Error('Matched record changed.');
  }else if(item.result==='added'){
   const fields=spec.fields.filter(field=>source[field]!==undefined&&source[field]!==null&&String(source[field]).trim()!=='');
   const values=fields.map(field=>String(source[field]).trim());
   if(entity==='farmers'){fields.push('registration_status','registration_date');values.push('not_registered',null);}
   else if(entity==='customers'){fields.push('source_sha256');values.push(sourceHash);}
   else{
    fields.push('record_type','source_sha256');values.push(source.record_type,sourceHash);
    if(source.record_type==='store'){
     const {rows:[parent]}=await db.query('SELECT id FROM distributors WHERE distributor_code=$1 AND record_type=$2',[source.parent_code,'distributor']);
     if(!parent)throw new Error('Store parent changed since preview.');
     fields.push('parent_id');values.push(parent.id);
    }
   }
   const saved=await db.query(`INSERT INTO ${spec.table}(${fields.join(',')}) VALUES(${fields.map((_,index)=>`$${index+1}`).join(',')}) RETURNING id`,values);
   recordId=saved.rows[0].id;
  }
  await db.query('INSERT INTO master_sync_rows(run_id,source_row,result,record_id,reason,changes) VALUES($1,$2,$3,$4,$5,$6)',[run.id,item.source_row,item.result,recordId,item.reason||null,JSON.stringify(item.changes)]);
  result[item.result]++;
 }
 await db.query('COMMIT');inTransaction=false;console.log(JSON.stringify({source_rows:plan.length,...result}));
}catch(error){if(inTransaction)await db.query('ROLLBACK');console.error('Synchronization stopped and rolled back:',error.code||error.message);process.exitCode=1;}finally{await db.end();}

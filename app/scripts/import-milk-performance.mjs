// Usage: node app/scripts/import-milk-performance.mjs preview|apply source.csv original.xlsx [--actor=name] [--revision-reason=text]
// Source files remain private; only hashes, cell provenance and normalized values enter PostgreSQL.
import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {parseCsv,normalizedWeeks,dbKeys,monthlyView,months,units} from '../milk-performance.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sameWeek(a,b){return a.source_row===b.row&&a.source_week_label===b.source_week_label&&a.original_pasteurization_expression===b.original_expression&&dbKeys.every(k=>units(a[k])===units(b.values[k]));}
export function planImport(weeks,current){
 const existing=new Map(current.map(r=>[`${r.report_year}-${r.report_month}-${r.week_number}`,r]));
 return weeks.map(week=>{const old=existing.get(`${week.year}-${week.month}-${week.week}`);return {week,old,action:old?(sameWeek(old,week)?'skip':'revise'):'insert'};});
}
export async function loadSource(csvPath,workbookPath){
 const [csvBytes,workbookBytes]=await Promise.all([readFile(csvPath),readFile(workbookPath)]);
 const raw=parseCsv(csvBytes.toString('utf8'));
 const selected=raw.map(r=>r.source_row).join(',');
 const parser=spawnSync('python3',[new URL('./xlsx-performance-rows.py',import.meta.url).pathname,workbookPath,selected],{encoding:'utf8',maxBuffer:20*1024*1024});
 if(parser.status!==0)throw new Error('Original workbook could not be validated.');
 const workbook=JSON.parse(parser.stdout);
 if(raw.some(r=>r.source_worksheet!==workbook.worksheet))throw new Error('Normalized worksheet differs from original workbook.');
 const weeks=normalizedWeeks(raw,workbook.rows);
 return {weeks,sourceHash:hash(workbookBytes),normalizedHash:hash(csvBytes),worksheet:workbook.worksheet};
}
const keyColumns='report_year,report_month,week_number,revision,source_row,source_week_label,original_pasteurization_expression';
const valuesSql=dbKeys.map(k=>`${k}::text`).join(',');
async function currentWeeks(db){const {rows}=await db.query(`SELECT id,${keyColumns},${valuesSql} FROM milk_performance_weeks WHERE is_current ORDER BY report_year,report_month,week_number`);return rows;}
function overview(plan,current=[]){
 const changes=plan.filter(x=>x.action!=='skip'),groups=new Map();
 for(const x of plan){const key=`${months[x.week.month-1]} ${x.week.year}`;const group=groups.get(key)||{year:x.week.year,month:x.week.month,weeks:new Map(current.filter(r=>r.report_year===x.week.year&&r.report_month===x.week.month).map(r=>[r.week_number,r])),inserted:0,revised:0,skipped:0,issues:0};group.weeks.set(x.week.week,{week_number:x.week.week,...x.week.values});group[x.action==='insert'?'inserted':x.action==='revise'?'revised':'skipped']++;group.issues+=x.week.issues.length;groups.set(key,group);}
 return {records:plan.length,inserted:changes.filter(x=>x.action==='insert').length,revised:changes.filter(x=>x.action==='revise').length,skipped:plan.filter(x=>x.action==='skip').length,issues:changes.reduce((n,x)=>n+x.week.issues.length,0),months:[...groups.entries()].map(([label,g])=>({month:label,weeks:g.weeks.size,inserted:g.inserted,revised:g.revised,skipped:g.skipped,issues:g.issues,totals:monthlyView([...g.weeks.values()])}))};
}
export async function importPerformance(db,source,options){
 if(!['preview','apply'].includes(options.mode))throw new Error('Choose preview or apply.');
 const {weeks,sourceHash,normalizedHash,worksheet}=source;
 const execute=async()=>{
  const current=await currentWeeks(db),plan=planImport(weeks,current),summary=overview(plan,current);
  const {rows:[prior]}=await db.query('SELECT id FROM milk_performance_import_batches WHERE source_sha256=$1 AND normalized_sha256=$2',[sourceHash,normalizedHash]);
  if(prior){return {...summary,inserted:0,revised:0,skipped:weeks.length,issues:0,already_imported:true};}
  if(options.mode==='preview')return summary;
  if(summary.revised&&(!options.revisionReason||options.revisionReason.trim().length<8))throw new Error('A review reason of at least eight characters is required for corrected figures.');
  if(!summary.inserted&&!summary.revised)return summary;
  const {rows:[batch]}=await db.query(`INSERT INTO milk_performance_import_batches(source_filename,source_sha256,normalized_filename,normalized_sha256,source_worksheet,actor,revision_reason,record_count,issue_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[basename(options.workbookPath),sourceHash,basename(options.csvPath),normalizedHash,worksheet,options.actor,options.revisionReason||null,summary.inserted+summary.revised,summary.issues]);
  for(const item of plan.filter(x=>x.action!=='skip')){
   const {week,old}=item;
   if(old){const updated=await db.query('UPDATE milk_performance_weeks SET is_current=false WHERE id=$1 AND is_current RETURNING id',[old.id]);if(updated.rowCount!==1)throw new Error('Concurrent historical revision detected.');}
   const cols=['import_batch_id','report_year','report_month','week_number','revision','source_row','source_week_label','original_pasteurization_expression',...dbKeys,'workbook_cells','normalized_source_row'];
   const vals=[batch.id,week.year,week.month,week.week,old?old.revision+1:1,week.row,week.source_week_label,week.original_expression,...dbKeys.map(k=>week.values[k]),JSON.stringify(week.workbook_cells),JSON.stringify(week.raw)];
   const {rows:[record]}=await db.query(`INSERT INTO milk_performance_weeks(${cols.join(',')}) VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,vals);
   for(const issue of week.issues)await db.query('INSERT INTO milk_performance_issues(week_id,metric,reported_value,calculated_value,difference,severity,note) VALUES($1,$2,$3,$4,$5,$6,$7)',[record.id,issue.metric,issue.reported_value,issue.calculated_value,issue.difference,issue.severity,issue.note]);
  }
  return {...summary,batch_id:batch.id};
 };
 if(options.mode==='preview')return execute();
 await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
 try{await db.query('SELECT pg_advisory_xact_lock(728410034)');const result=await execute();await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 let db;
 try{
  const [mode,csvPath,workbookPath,...flags]=process.argv.slice(2);if(!mode||!csvPath||!workbookPath)throw new Error('Provide mode, normalized CSV and original workbook.');
  const config=Object.fromEntries(flags.map(f=>{const m=f.match(/^--([a-z-]+)=(.*)$/);if(!m)throw new Error('Invalid option');return [m[1],m[2]];}));
  const actor=config.actor||'Satima administrator';if(actor.length>100)throw new Error('Actor name is too long.');
  const url=new URL(process.env.ADMIN_DATABASE_URL||'');if(url.pathname!=='/satima_cms')throw new Error('An owner connection to satima_cms is required.');
  if(!['localhost','127.0.0.1'].includes(url.hostname)&&url.searchParams.get('sslmode')!=='verify-full')throw new Error('Verified TLS is required for remote imports.');
  const source=await loadSource(csvPath,workbookPath);
  db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=60000'});await db.connect();
  const result=await importPerformance(db,source,{mode,csvPath,workbookPath,actor,revisionReason:config['revision-reason']});
  console.log(JSON.stringify(result));
 }catch(error){console.error('Historical performance import failed:',error.message);process.exitCode=1;}finally{await db?.end();}
}

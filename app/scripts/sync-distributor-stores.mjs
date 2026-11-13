// Repeat-safe, owner-only synchronization for the reviewed distributor/store CSV.
// The source file and generated plan must remain outside the repository.
import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const [mode,sourcePath,planPath]=process.argv.slice(2);
if(!['check','apply'].includes(mode)||!sourcePath||!planPath)throw new Error('Usage: sync-distributor-stores.mjs check|apply /private/source.csv /private/plan.json');
if(!process.env.ADMIN_DATABASE_URL)throw new Error('Owner database connection required.');

function csv(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}
  else if(ch==='"')quoted=true;
  else if(ch===','){row.push(cell);cell='';}
  else if(ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
  else cell+=ch;
 }
 if(quoted)throw new Error('Unclosed CSV quote.');
 if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
 const headers=rows.shift()?.map((value,index)=>index===0?value.replace(/^\uFEFF/,'').trim():value.trim());
 const expected=['Distributor','Store','Lines Person','Lines Person Phone'];
 if(JSON.stringify(headers)!==JSON.stringify(expected))throw new Error('CSV headers must be Distributor, Store, Lines Person, Lines Person Phone.');
 return rows.filter(r=>r.some(v=>v.trim())).map((cells,index)=>{
  if(cells.length!==headers.length)throw new Error(`CSV column count differs on row ${index+2}.`);
  return Object.fromEntries(headers.map((key,col)=>[key,cells[col].trim()]).concat([['source_row',index+2]]));
 });
}
const compact=value=>String(value||'').toLocaleLowerCase('en').replace(/[–—]/g,'-').replace(/[^a-z0-9]+/g,'');
function distributorKey(value){
 let key=compact(value).replace(/ho$/,'');
 key=key.replace(/^chandrana/,'chandarana').replace(/^karenprovisionalstores$/,'karenprovisionstores');
 return key;
}
function storeKey(value){
 let key=compact(value).replace(/^chandrana/,'chandarana');
 key=key.replace(/^cleanshelfsupermarket/,'').replace(/^cleanshelf/,'');
 return key;
}
const source=csv((await readFile(sourcePath)).toString('utf8'));
const sourceHash=createHash('sha256').update(await readFile(sourcePath)).digest('hex');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL,connectionTimeoutMillis:15000,options:'-c lock_timeout=5000 -c statement_timeout=120000'});
await db.connect();
async function compare(){
 const {rows:existing}=await db.query(`SELECT d.id,d.distributor_code,d.store_code,d.name,d.record_type,d.parent_id,p.name AS parent_name,d.lines_person_name,d.phone_number
  FROM distributors d LEFT JOIN distributors p ON p.id=d.parent_id ORDER BY d.record_type,d.name`);
 const distributors=source.reduce((all,row)=>all.some(x=>distributorKey(x.Distributor)===distributorKey(row.Distributor))?all:[...all,{name:row.Distributor,key:distributorKey(row.Distributor)}],[]);
 const existingDistributors=existing.filter(x=>x.record_type==='distributor');
 const byDistributor=new Map(existingDistributors.map(x=>[distributorKey(x.name),x]));
 const missingDistributors=distributors.filter(x=>!byDistributor.has(x.key));
 const storeMatches=[],missingStores=[];
 for(const row of source){
  const match=existing.find(x=>x.record_type==='store'&&storeKey(x.name)===storeKey(row.Store));
  if(match)storeMatches.push({source:row,existing:match});else missingStores.push(row);
 }
 const sourceMatchedIds=new Set(storeMatches.map(x=>x.existing.id));
 const inCmsNotSource=existing.filter(x=>x.record_type==='store'&&!sourceMatchedIds.has(x.id));
 const contactFills=[],conflicts=[],parentFixes=[],parentConflicts=[];
 for(const item of storeMatches){
  const {source:s,existing:e}=item;
  for(const [field,label] of [['lines_person_name','Lines Person'],['phone_number','Lines Person Phone']]){
   const incoming=field==='lines_person_name'?s['Lines Person']:s['Lines Person Phone'];
   const current=e[field]||'';
   if(!current&&incoming)contactFills.push({id:e.id,name:e.name,field,label,value:incoming,source_row:s.source_row});
   else if(current&&incoming&&current!==incoming)conflicts.push({name:e.name,field:label,cms:current,csv:incoming,source_row:s.source_row});
  }
  const expected=byDistributor.get(distributorKey(s.Distributor))||missingDistributors.find(x=>x.key===distributorKey(s.Distributor));
  const parentKey=e.parent_name?distributorKey(e.parent_name):null;
  if(expected&&!e.parent_id)parentFixes.push({id:e.id,name:e.name,parent_id:expected.id||null,parent_key:expected.key,parent_name:expected.name,source_row:s.source_row});
  else if(expected&&parentKey!==distributorKey(expected.name))parentConflicts.push({name:e.name,current_parent:e.parent_name||null,expected_parent:expected.name,source_row:s.source_row});
 }
 const plan={source_sha256:sourceHash,source_rows:source.length,existing_count:existing.length,already_distributors:distributors.filter(x=>byDistributor.has(x.key)).map(x=>({source_name:x.name,cms_name:byDistributor.get(x.key).name})),already_in_cms:storeMatches.map(x=>({distributor:x.source.Distributor,store:x.source.Store,cms_name:x.existing.name,parent:x.existing.parent_name||null})),missing_distributors:missingDistributors,missing_stores:missingStores,contacts_to_fill:contactFills,contact_conflicts:conflicts,parent_fixes:parentFixes,parent_conflicts:parentConflicts,in_cms_not_in_csv:inCmsNotSource.map(x=>({name:x.name,parent:x.parent_name||null,record_type:x.record_type}))};
 plan.plan_sha256=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
 return plan;
}
try{
 const plan=await compare();
 if(mode==='check'){
  await writeFile(planPath,JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({source_rows:plan.source_rows,already_distributors:plan.already_distributors.length,already_stores:plan.already_in_cms.length,missing_distributors:plan.missing_distributors.length,missing_stores:plan.missing_stores.length,contacts_to_fill:plan.contacts_to_fill.length,contact_conflicts:plan.contact_conflicts.length,parent_fixes:plan.parent_fixes.length,parent_conflicts:plan.parent_conflicts.length,in_cms_not_in_csv:plan.in_cms_not_in_csv.length,plan:planPath}));
  process.exit(0);
 }
 const reviewed=JSON.parse(await readFile(planPath,'utf8'));
 if(reviewed.source_sha256!==plan.source_sha256||reviewed.plan_sha256!==plan.plan_sha256)throw new Error('Source or live database changed since check; generate a fresh plan.');
 if(plan.contact_conflicts.length||plan.parent_conflicts.length)throw new Error('Conflicts require review before apply.');
 await db.query('BEGIN');
 await db.query('SELECT pg_advisory_xact_lock(728410030)');
 const {rows:[prior]}=await db.query('SELECT id FROM master_sync_runs WHERE entity=$1 AND source_sha256=$2',['distributors',sourceHash]);
 if(prior){await db.query('ROLLBACK');console.log('This source file was already synchronized.');process.exit(0);}
 const distributorIds=new Map((await db.query("SELECT id,name FROM distributors WHERE record_type='distributor' FOR UPDATE")).rows.map(r=>[distributorKey(r.name),r.id]));
 for(const item of plan.missing_distributors){
  const {rows:[saved]}=await db.query(`INSERT INTO distributors(name,record_type,source_sha256) VALUES($1,'distributor',$2) RETURNING id`,[item.name,sourceHash]);
  distributorIds.set(item.key,saved.id);
 }
 for(const item of plan.missing_stores){
  const parent=distributorIds.get(distributorKey(item.Distributor));if(!parent)throw new Error(`Missing parent for ${item.Store}.`);
  await db.query(`INSERT INTO distributors(name,record_type,parent_id,lines_person_name,phone_number,source_sha256) VALUES($1,'store',$2,$3,$4,$5)`,[item.Store,parent,item['Lines Person']||null,item['Lines Person Phone']||null,sourceHash]);
 }
 for(const item of plan.contacts_to_fill){
  const column=item.field==='Lines Person'?'lines_person_name':'phone_number';
  await db.query(`UPDATE distributors SET ${column}=$2,updated_at=now() WHERE id=$1 AND ${column} IS NULL`,[item.id,item.value]);
 }
 for(const item of plan.parent_fixes){
  const parentId=item.parent_id||distributorIds.get(item.parent_key);if(!parentId)throw new Error(`Missing parent for ${item.name}.`);
  await db.query(`UPDATE distributors SET parent_id=$2,updated_at=now() WHERE id=$1 AND parent_id IS NULL`,[item.id,parentId]);
 }
 const {rows:[run]}=await db.query('INSERT INTO master_sync_runs(entity,source_sha256,plan_sha256,row_count) VALUES($1,$2,$3,$4) RETURNING id',['distributors',sourceHash,plan.plan_sha256,source.length]);
 for(const row of source){
  const matched=plan.already_in_cms.find(x=>x.source_row===row.source_row||x.store===row.Store);
  const added=plan.missing_stores.some(x=>x.source_row===row.source_row);
  const filled=plan.contacts_to_fill.some(x=>x.source_row===row.source_row)||plan.parent_fixes.some(x=>x.source_row===row.source_row);
  const result=added?'added':filled?'updated':'unchanged';
  await db.query('INSERT INTO master_sync_rows(run_id,source_row,result,reason,changes) VALUES($1,$2,$3,$4,$5)',[run.id,row.source_row,result,null,JSON.stringify({})]);
 }
 await db.query('COMMIT');
 console.log(JSON.stringify({added_distributors:plan.missing_distributors.length,added_stores:plan.missing_stores.length,contacts_filled:plan.contacts_to_fill.length,parent_fixes:plan.parent_fixes.length}));
}catch(error){try{await db.query('ROLLBACK')}catch{};console.error('Distributor/store synchronization stopped and rolled back:',error.code||error.message);process.exitCode=1;}finally{await db.end();}

import {Problem} from './store.mjs';

export async function farmerSupplyHistory(pool,farmerId){
 const {rows:[totals]}=await pool.query(`SELECT count(quantity_liters)::int AS records,
   coalesce(sum(quantity_liters),0)::text AS total_liters,
   min(supply_date) FILTER (WHERE quantity_liters IS NOT NULL)::text AS first_date,
   max(supply_date) FILTER (WHERE quantity_liters IS NOT NULL)::text AS latest_date,
   count(DISTINCT supply_date) FILTER (WHERE quantity_liters IS NOT NULL)::int AS supply_days
   FROM farmer_supply_history WHERE farmer_id=$1 AND is_current`,[farmerId]);
 const {rows:monthly}=await pool.query(`SELECT to_char(date_trunc('month',supply_date),'YYYY-MM') AS month,
   sum(quantity_liters)::text AS liters,count(*)::int AS records
   FROM farmer_supply_history WHERE farmer_id=$1 AND is_current AND quantity_liters IS NOT NULL
   GROUP BY 1 ORDER BY 1 DESC`,[farmerId]);
 const {rows:records}=await pool.query(`SELECT supply_date::text,quantity_liters::text,source_category,original_value,match_status
   FROM farmer_supply_history WHERE farmer_id=$1 AND is_current AND quantity_liters IS NOT NULL ORDER BY supply_date DESC,id DESC LIMIT 100`,[farmerId]);
 return {totals,monthly,records};
}

export function normalizePhone(value){
 const digits=String(value??'').replace(/\D/g,'');
 if(/^0[17]\d{8}$/.test(digits))return '+254'+digits.slice(1);
 if(/^254[17]\d{8}$/.test(digits))return '+'+digits;
 if(/^[17]\d{8}$/.test(digits))return '+254'+digits;
 return null;
}

export function parseSupplyCsv(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw new Error('Unclosed CSV quote');if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
 const header=rows.shift()?.map(v=>v.trim());if(!header?.length||new Set(header).size!==header.length)throw new Error('Invalid supply CSV header');
 return rows.filter(r=>r.some(v=>v.trim())).map((r,i)=>{if(r.length!==header.length)throw new Error(`Invalid supply CSV column count at row ${i+2}`);const o=Object.fromEntries(header.map((h,j)=>[h,r[j].trim()]));o.source_row=Number(o.source_row||i+2);return o;});
}

const date=/^\d{4}-\d{2}-\d{2}$/;
const quantity=/^(?:0|\d+)(?:\.\d{1,6})?$/;
export async function importFarmerSupply(db,rows,{sourceFilename,sourceHash,normalizedHash,worksheet='Table 1',actor='Satima administrator',revisionReason=null,mode='preview'}={}){
 if(!/^[a-f0-9]{64}$/.test(sourceHash||'')||!/^[a-f0-9]{64}$/.test(normalizedHash||''))throw new Error('Source and normalized SHA-256 hashes are required.');
 if(!rows.length)throw new Error('No farmer supply rows found.');
 for(const r of rows){if(!Number.isInteger(r.source_row)||r.source_row<1||!r.source_name?.trim()||!r.source_category?.trim()||!date.test(r.supply_date)||r.quantity_liters!==''&&!quantity.test(r.quantity_liters))throw new Error(`Invalid farmer supply row ${r.source_row}.`);}
 const {rows:existing}=await db.query(`SELECT f.id,f.full_name,f.primary_phone FROM farmers f WHERE f.record_kind='registered'`);
 const normName=s=>String(s||'').trim().replace(/\s+/g,' ').toLowerCase();const byPhone=new Map(),byName=new Map();
 for(const f of existing){const p=normalizePhone(f.primary_phone),n=normName(f.full_name);if(p){if(!byPhone.has(p))byPhone.set(p,[]);byPhone.get(p).push(f);}if(!byName.has(n))byName.set(n,[]);byName.get(n).push(f);}
 const planned=rows.map(r=>{const p=normalizePhone(r.source_phone),pc=p?(byPhone.get(p)||[]):[],nc=byName.get(normName(r.source_name))||[];const match=pc.length===1?pc[0]:pc.length===0&&nc.length===1?nc[0]:null;return {...r,normalized_phone:p,farmer_id:match?.id||null,match_status:match?'matched':pc.length>1||nc.length>1?'review':'unmatched'};});
 const result={rows:planned.length,matched:planned.filter(r=>r.match_status==='matched').length,review:planned.filter(r=>r.match_status==='review').length,unmatched:planned.filter(r=>r.match_status==='unmatched').length,inserted:0,skipped:0};
 if(mode==='preview')return {...result,planned};
 if(mode!=='apply')throw new Error('Choose preview or apply.');
 await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
 try{await db.query('SELECT pg_advisory_xact_lock(728410031)');const prior=await db.query('SELECT id FROM farmer_supply_import_batches WHERE source_sha256=$1 AND normalized_sha256=$2',[sourceHash,normalizedHash]);if(prior.rowCount){await db.query('ROLLBACK');return {...result,skipped:planned.length,already_imported:true,planned};}
  const {rows:[batch]}=await db.query(`INSERT INTO farmer_supply_import_batches(source_filename,source_sha256,normalized_sha256,source_worksheet,actor,revision_reason,record_count) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[sourceFilename,sourceHash,normalizedHash,worksheet,actor,revisionReason,planned.length]);
  const oldResult=await db.query('SELECT id,source_row,supply_date,revision FROM farmer_supply_history WHERE is_current AND source_row=ANY($1::int[]) FOR UPDATE',[planned.map(r=>r.source_row)]);
  const oldByKey=new Map(oldResult.rows.map(r=>[`${r.source_row}|${r.supply_date.toISOString().slice(0,10)}`,r]));
  for(const old of oldResult.rows)await db.query('UPDATE farmer_supply_history SET is_current=false WHERE id=$1',[old.id]);
  const columns=['import_batch_id','farmer_id','source_row','source_name','source_phone','normalized_phone','source_category','supply_date','quantity_liters','original_value','match_status','revision'];
  for(let start=0;start<planned.length;start+=100){const chunk=planned.slice(start,start+100),values=[],placeholders=[];for(const r of chunk){const old=oldByKey.get(`${r.source_row}|${r.supply_date}`),row=[batch.id,r.farmer_id,r.source_row,r.source_name,r.source_phone||null,r.normalized_phone,r.source_category,r.supply_date,r.quantity_liters===''?null:r.quantity_liters,r.original_value||null,r.match_status,old?old.revision+1:1];const offset=values.length;values.push(...row);placeholders.push(`(${row.map((_,i)=>'$'+(offset+i+1)).join(',')})`);result.inserted++;}await db.query(`INSERT INTO farmer_supply_history(${columns.join(',')}) VALUES ${placeholders.join(',')}`,values);}
  await db.query('COMMIT');return {...result,batch_id:batch.id,planned};
 }catch(e){await db.query('ROLLBACK');throw e;}
}

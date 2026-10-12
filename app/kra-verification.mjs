import {Problem,text} from './store.mjs';

export const KRA_CHECKER_URL='https://itax.kra.go.ke/KRA-Portal/pinChecker.htm';
export function normalizedPin(value){return typeof value==='string'?value.trim().toUpperCase():'';}
export function pinFormat(value){const pin=normalizedPin(value);return !pin?'missing':/^[AP][0-9]{9}[A-Z]$/.test(pin)?'valid':'invalid';}
const tokens=value=>String(value||'').toUpperCase().replace(/[^A-Z\s]/g,' ').trim().split(/\s+/).filter(Boolean);
export function compareNames(farmer,taxpayer){const a=tokens(farmer),b=tokens(taxpayer);if(!b.length)return 'not_checked';if(a.join(' ')===b.join(' '))return 'exact';const x=[...a].sort().join(' '),y=[...b].sort().join(' ');if(x===y)return 'exact';const common=a.filter(t=>b.includes(t));return common.length>=2&&(common.length>=Math.min(a.length,b.length)-1)?'possible':'mismatch';}
export async function officialCheck(){throw new Problem(503,'Official KRA API access is not configured. Use the KRA PIN Checker and record the result manually.');}
export async function listKra(pool,params){
 const rawPage=params.get('page')||'1',q=(params.get('q')||'').trim();
 if(!/^[1-9]\d{0,5}$/.test(rawPage)||q.length>100)throw new Problem(400,'Invalid verification search or page.');
 const page=Number(rawPage),limit=50,needle='%'+q.toLowerCase().replace(/[\\%_]/g,'\\$&')+'%';
 const base=`FROM farmers f LEFT JOIN LATERAL (SELECT v.* FROM farmer_kra_verifications v WHERE v.farmer_id=f.id ORDER BY v.created_at DESC,v.id DESC LIMIT 1) v ON true WHERE f.record_kind='registered' AND f.registration_status='registered'`;
 const {rows:[stats]}=await pool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE f.kra_pin_format='missing')::int missing,count(*) FILTER(WHERE f.kra_pin_format='invalid')::int invalid,count(*) FILTER(WHERE v.outcome='verified' AND v.pin_snapshot=coalesce(f.kra_pin,''))::int verified,count(*) FILTER(WHERE f.kra_pin_format<>'valid' OR (v.pin_snapshot=coalesce(f.kra_pin,'') AND (v.outcome='needs_review' OR v.name_match IN ('possible','mismatch'))))::int review ${base}`);
 stats.pending=stats.total-stats.verified;
 const where=q?` AND (lower(f.full_name) LIKE $1 ESCAPE E'\\\\' OR lower(coalesce(f.customer_id,'')) LIKE $1 ESCAPE E'\\\\' OR lower(coalesce(f.kra_pin,'')) LIKE $1 ESCAPE E'\\\\')`:'';
 const values=q?[needle]:[];
 const {rows:[count]}=await pool.query(`SELECT count(*)::int total ${base}${where}`,values);
 const {rows}=await pool.query(`SELECT f.id,f.customer_id,f.full_name,f.kra_pin,f.kra_pin_format,coalesce(v.outcome,'pending') kra_status,coalesce(v.name_match,'not_checked') name_match,v.pin_snapshot,v.checked_at,v.checked_by FROM farmers f LEFT JOIN LATERAL (SELECT v.* FROM farmer_kra_verifications v WHERE v.farmer_id=f.id ORDER BY v.created_at DESC,v.id DESC LIMIT 1) v ON true WHERE f.record_kind='registered' AND f.registration_status='registered'${where} ORDER BY substring(f.customer_id from 6)::numeric,f.id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,limit,(page-1)*limit]);
 return {stats,records:rows.map(row=>({...row,format:row.kra_pin_format,kra_status:row.pin_snapshot===(row.kra_pin||'')?row.kra_status:'pending',name_match:row.pin_snapshot===(row.kra_pin||'')?row.name_match:'not_checked'})),pagination:{page,page_size:limit,total:count.total,total_pages:Math.ceil(count.total/limit)}};
}
export async function kraHistory(pool,id){const {rows:[farmer]}=await pool.query("SELECT id,customer_id,full_name,kra_pin FROM farmers WHERE id=$1 AND record_kind='registered'",[id]);if(!farmer)throw new Problem(404,'Farmer not found.');const {rows}=await pool.query('SELECT id,pin_snapshot,previous_status,outcome,taxpayer_name,pin_status,name_match,method,checked_at,checked_by,remarks,evidence_reference,actor,source_portal,created_at FROM farmer_kra_verifications WHERE farmer_id=$1 ORDER BY created_at DESC,id DESC',[id]);return {farmer,format:pinFormat(farmer.kra_pin),revision:rows[0]?.id??null,history:rows};}
export async function recordKraCheck(c,id,input,actor,sourcePortal='Admin'){
 const {rows:[farmer]}=await c.query("SELECT id,customer_id,full_name,kra_pin FROM farmers WHERE id=$1 AND record_kind='registered' FOR UPDATE",[id]);if(!farmer)throw new Problem(404,'Farmer not found.');
 if(typeof input.expected_pin!=='string'||normalizedPin(input.expected_pin)!==normalizedPin(farmer.kra_pin))throw new Problem(409,'The recorded PIN has changed. Reopen this review before saving.');
 const outcome=text(input.outcome,'Official outcome',true),format=pinFormat(farmer.kra_pin),method=format==='valid'?'manual_checker':'manual_review';if(!['verified','failed','unavailable','needs_review'].includes(outcome))throw new Problem(400,'Choose a valid outcome.');
 if(format!=='valid'&&outcome!=='needs_review')throw new Problem(400,'Only Needs review can be recorded for a missing or malformed PIN.');
 const taxpayer=text(input.taxpayer_name,'Taxpayer name',false,300),pinStatus=text(input.pin_status,'PIN status',false,100),checkedBy=text(input.checked_by,'Checked by',true,150),remarks=text(input.remarks,'Remarks',false,2000),evidence=text(input.evidence_reference,'Evidence reference',false,300);
 const checkedAt=text(input.checked_at,'Verification date',true);if(!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)||Number.isNaN(Date.parse(checkedAt))||new Date(checkedAt).toISOString().slice(0,10)!==checkedAt)throw new Problem(400,'Enter a valid verification date.');
 if(outcome==='verified'&&(!taxpayer||!pinStatus))throw new Problem(400,'A verified result requires the KRA taxpayer name and PIN status.');
 const {rows:[previous]}=await c.query('SELECT id,outcome,pin_snapshot FROM farmer_kra_verifications WHERE farmer_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[id]);
 if(!Object.hasOwn(input,'expected_revision')||(input.expected_revision!==null&&String(input.expected_revision)!==String(previous?.id))||(input.expected_revision===null&&previous))throw new Problem(409,'This verification was updated by another user. Reopen it before saving.');
 const pinSnapshot=farmer.kra_pin||'',previousStatus=previous?.pin_snapshot===pinSnapshot?previous.outcome:'pending';
 const nameMatch=compareNames(farmer.full_name,taxpayer);
 const {rows:[result]}=await c.query(`INSERT INTO farmer_kra_verifications(farmer_id,pin_snapshot,previous_status,outcome,taxpayer_name,pin_status,name_match,method,checked_at,checked_by,remarks,evidence_reference,actor,source_portal) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14) RETURNING id,outcome,name_match`,[id,pinSnapshot,previousStatus,outcome,taxpayer,pinStatus,nameMatch,method,checkedAt,checkedBy,remarks,evidence,actor,sourcePortal]);
 return result;
}

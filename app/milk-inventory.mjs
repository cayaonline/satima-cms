import {Problem} from './store.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date=/^\d{4}-\d{2}-\d{2}$/;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function clean(value,name,min,max){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw new Problem(400,`${name} must be ${min}–${max} characters.`);return value.trim();}
export function openingInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Problem(400,'Enter an opening balance.');
 const stock_type=input.stock_type;
 if(!['raw','pasteurized'].includes(stock_type))throw new Problem(400,'Choose raw or pasteurized stock.');
 const quantity_liters=String(input.quantity_liters??'');
 if(!/^\d+(?:\.\d{1,6})?$/.test(quantity_liters)||Number(quantity_liters)<=0)throw new Problem(400,'Enter a positive quantity with at most six decimal places.');
 const effective_on=input.effective_on;
 if(typeof effective_on!=='string'||!date.test(effective_on)||Number.isNaN(Date.parse(effective_on))||new Date(effective_on).toISOString().slice(0,10)!==effective_on||effective_on>today())throw new Problem(400,'Enter a valid current or past stock date.');
 if(!uuid.test(input.idempotency_key||''))throw new Problem(400,'A valid submission key is required.');
 return {stock_type,quantity_liters,effective_on,source_reference:clean(input.source_reference,'Source reference',3,200),verification_notes:clean(input.verification_notes,'Verification notes',10,2000),idempotency_key:input.idempotency_key};
}
export async function proposeOpening(db,input,actor='Administrator'){
 const value=openingInput(input);
 const existing=await db.query('SELECT *,effective_on::text AS effective_on,quantity_liters::text AS quantity_liters FROM milk_inventory_opening_balances WHERE idempotency_key=$1',[value.idempotency_key]);
 if(existing.rowCount){const row=existing.rows[0];if(Object.keys(value).some(key=>String(row[key] instanceof Date?row[key].toISOString().slice(0,10):row[key])!==String(value[key])))throw new Problem(409,'This submission key was already used for different stock details.');return {id:row.id,status:row.status,already_saved:true};}
 const approved=await db.query("SELECT 1 FROM milk_inventory_opening_balances WHERE stock_type=$1 AND status='approved'",[value.stock_type]);
 if(approved.rowCount)throw new Problem(409,'An opening balance is already approved for this stock type.');
 const {rows:[row]}=await db.query(`INSERT INTO milk_inventory_opening_balances(stock_type,quantity_liters,effective_on,source_reference,verification_notes,proposed_by,idempotency_key)
 VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,status`,[value.stock_type,value.quantity_liters,value.effective_on,value.source_reference,value.verification_notes,actor,value.idempotency_key]);
 return {...row,already_saved:false};
}
export async function reviewOpening(db,id,input,actor='Administrator'){
 if(!uuid.test(id))throw new Problem(400,'Invalid opening balance identifier.');
 if(!input||!['approved','rejected'].includes(input.decision))throw new Problem(400,'Choose Approve or Reject.');
 const reviewer=clean(input.reviewer_name,'Reviewer name',2,100),reason=clean(input.reason,'Review reason',10,500);
 const {rows:[row]}=await db.query('SELECT *,effective_on::text AS effective_on FROM milk_inventory_opening_balances WHERE id=$1 FOR UPDATE',[id]);
 if(!row)throw new Problem(404,'Opening balance not found.');
 if(row.status!=='pending')throw new Problem(409,'This opening balance was already reviewed.');
 await db.query('UPDATE milk_inventory_opening_balances SET status=$2,reviewed_by=$3,reviewed_at=now(),review_reason=$4 WHERE id=$1',[id,input.decision,`${reviewer} (${actor})`,reason]);
 if(input.decision==='approved')await db.query(`INSERT INTO milk_inventory_movements(stock_type,inventory_state,movement_type,quantity_liters,effective_on,reason,source_type,source_id,opening_balance_id,recorded_by,approved_by)
 VALUES($1,'available','opening_balance',$2,$3,$4,'approved_opening_balance',$5,$5,$6,$7)`,[row.stock_type,row.quantity_liters,row.effective_on,`Approved opening balance: ${reason}`,id,row.proposed_by,`${reviewer} (${actor})`]);
 return {id,status:input.decision};
}
export async function inventorySummary(db,{admin=false}={}){
 const {rows:balances}=await db.query(`SELECT stock_type,inventory_state,coalesce(sum(quantity_liters),0)::text AS quantity_liters,count(*)::int AS movement_count
 FROM milk_inventory_movements GROUP BY stock_type,inventory_state ORDER BY stock_type,inventory_state`);
 const {rows:openings}=await db.query(`SELECT id,stock_type,quantity_liters::text,effective_on::text,source_reference,status,proposed_at,reviewed_at${admin?',verification_notes,proposed_by,reviewed_by,review_reason':''}
 FROM milk_inventory_opening_balances ORDER BY proposed_at DESC`);
 return {scope:'prospective_ledger',reconciled_with_operational_stock:false,notice:'Only approved opening balances and future verified movements belong to this ledger. Existing batch availability remains separately enforced. Historical carry-forward has not been posted.',balances,openings:admin?openings:openings.filter(row=>row.status==='approved')};
}

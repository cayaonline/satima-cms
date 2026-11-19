import {salesData} from './collections-sales.mjs';
import {enrichSalesLedger} from './collections-ledger.mjs';
import {retailData} from './collections-retail.mjs';
const problem=(status,message)=>Object.assign(new Error(message),{status});
const stages=['contact_planned','contacted','promise_to_pay','disputed','legal_review_requested','legal_referred','closed'];
export function validateReview(input){
 if(!input||!['overdue','not_overdue','needs_review','overpaid'].includes(input.overdueState))throw problem(400,'Choose an overdue classification.');
 const reason=typeof input.reason==='string'?input.reason.trim():'',reviewer=typeof input.reviewerName==='string'?input.reviewerName.trim():'';
 if(reason.length<5||reason.length>2000)throw problem(400,'Provide a review reason between 5 and 2,000 characters.');
 if(reviewer.length<2||reviewer.length>150)throw problem(400,'Provide the reviewer name.');
 if(input.followUpStage!==null&&!stages.includes(input.followUpStage))throw problem(400,'Choose a valid follow-up stage.');
 if(typeof input.expectedRevision!=='string'||!/^\d{1,18}$/.test(input.expectedRevision))throw problem(400,'Refresh the account before reviewing.');
 return {...input,reason,reviewerName:reviewer};
}
export function enrichHome(records,metadata,reviews){
 const byRow=new Map(metadata.map(r=>[r.source_row,r])),latest=new Map(reviews.map(r=>[r.source_row,r]));
 return records.map(record=>{
  const source=byRow.get(record.row),review=latest.get(record.row);
  return {...record,channel:'home_customers',sourceOverdue:source?.source_overdue??null,styleEvidence:source?.style_evidence??[],
   invoiceDate:source?.invoice_date??null,invoiceMonth:source?.invoice_month??null,dueDate:source?.due_date??null,
   overdueState:review?.overdue_state||(source?.source_overdue?'needs_review':source?'not_flagged':'unknown'),
   classificationBasis:review?'staff_review':source?.source_overdue?'workbook_red_review_flag':source?'no_source_flag':'not_verified',
   reviewId:String(review?.id||'0'),followUpStage:review?.follow_up_stage??null};
 });
}
export function homeSummary(records){
 const cents=(rows,field)=>rows.reduce((sum,r)=>sum+Math.round(r[field]*100),0)/100;
 const source=records.filter(r=>r.sourceOverdue===true),current=records.filter(r=>r.overdueState==='overdue');
 const ready=records.every(r=>r.sourceOverdue!==null);
 return {sourceFlagsVerified:ready,sourceFlaggedCount:ready?source.length:null,sourceFlaggedBalance:ready?cents(source,'amount'):null,
  currentOverdueCount:ready?current.length:null,currentOverdueListed:ready?cents(current,'amount'):null,
  currentOverdueConditionalOutstanding:ready?cents(current,'balance'):null,dueDateUnknownCount:records.filter(r=>!r.dueDate).length,
  invoiceDateUnknownCount:records.filter(r=>!r.invoiceDate).length,followUpsRecorded:records.filter(r=>r.followUpStage).length,
  legalReviewsRecorded:records.filter(r=>['legal_review_requested','legal_referred'].includes(r.followUpStage)).length};
}
export async function channelsData(pool,records,{includePaymentLedger=true}={}){
 const [source,latest,retailers,retail,sales]=await Promise.all([
  pool.query("SELECT * FROM collections_home_accounts WHERE dataset_id='october' ORDER BY source_row"),
  pool.query("SELECT DISTINCT ON (source_row) * FROM collections_account_reviews WHERE dataset_id='october' ORDER BY source_row,id DESC"),
  pool.query('SELECT code,name,source_status FROM collections_retailers ORDER BY code'),retailData(pool),salesData(pool)
 ]);
 const enriched=enrichHome(records,source.rows,latest.rows),ledgerSales=includePaymentLedger?await enrichSalesLedger(pool,sales):sales;
 const customerDirectory=includePaymentLedger?(await pool.query('SELECT id::text,customer_id,full_name FROM customers ORDER BY lower(full_name),customer_id')).rows:undefined;
 return {records:enriched,home:homeSummary(enriched),retailers:retailers.rows,retail,sales:ledgerSales,...(customerDirectory?{customerDirectory}:{}),
  reporting:{label:'Customer receivables snapshot supplied in the October workbook',invoiceMonth:null,invoiceDate:null,snapshotAsOf:null,classificationBasis:'Home Customers channel assigned by owner clarification, not inferred from account names.',companyCollectionRate:null}};
}
export async function reviewHistory(pool,row,before){
 if(!Number.isInteger(row)||row<2)throw problem(400,'Invalid source row.');
 if(before&&!/^\d{1,18}$/.test(before))throw problem(400,'Invalid history cursor.');
 const {rows}=await pool.query("SELECT id::text,overdue_state,follow_up_stage,reason,reviewer_name,actor,reviewed_at FROM collections_account_reviews WHERE dataset_id='october' AND source_row=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 101",[row,before||null]);
 return {entries:rows.slice(0,100),nextBefore:rows.length>100?rows[99].id:null};
}
export async function saveReview(pool,row,input,actor){
 const value=validateReview(input);
 if(!Number.isInteger(row)||row<2)throw problem(400,'Invalid source row.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(728410040,$1)',[row]);
  const {rows:[account]}=await client.query("SELECT source_row FROM collections_home_accounts WHERE dataset_id='october' AND source_row=$1",[row]);
  if(!account)throw problem(404,'Source account not found or not yet verified.');
  const {rows:[latest]}=await client.query("SELECT id::text FROM collections_account_reviews WHERE dataset_id='october' AND source_row=$1 ORDER BY id DESC LIMIT 1",[row]);
  if((latest?.id||'0')!==value.expectedRevision)throw problem(409,'Another review was saved. Refresh and review the latest classification.');
  const {rows:[saved]}=await client.query("INSERT INTO collections_account_reviews(dataset_id,source_row,overdue_state,follow_up_stage,reason,reviewer_name,actor) VALUES('october',$1,$2,$3,$4,$5,$6) RETURNING id::text",[row,value.overdueState,value.followUpStage,value.reason,value.reviewerName,actor]);
  await client.query('COMMIT');return saved;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

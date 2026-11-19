const problem=(status,message)=>Object.assign(new Error(message),{status});
const cents=value=>Math.round(Number(value||0)*100);
const amountText=value=>(cents(value)/100).toFixed(2);
const isoDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

export function sourceStatus(value){
 if(['Paid','paid'].includes(value))return 'Paid';
 if(['Not Paid','Unpaid','unpaid'].includes(value))return 'Unpaid';
 if(['Partial','Partially Paid','partially_paid'].includes(value))return 'Unpaid';
 return null;
}

export async function insertInvoiceProjection(client,reportId,period,payload){
 for(const [channel,rows] of [['home_customers',payload.homes||[]],['distributors_stores',payload.stores||[]]]){
  for(const row of rows){
   const sourceReference=String(row.sourceReference||`source row ${row.row}`);
   await client.query(`INSERT INTO collections_invoice_records(source_report_id,reporting_month,channel,source_reference,source_row,source_name,distributor_code,invoice_date,due_date,source_payment_status,amount)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(source_report_id,channel,source_reference) DO NOTHING`,
    [reportId,`${period}-01`,channel,sourceReference,Number.isInteger(row.row)?row.row:null,row.displayName||row.name||'Unknown source account',row.code||null,row.invoiceDate||null,row.dueDate||null,sourceStatus(row.paymentStatus),amountText(row.amount)]);
  }
 }
}

export async function enrichSalesLedger(pool,sales){
 if(!sales?.reports?.length)return sales;
 const [{rows:invoices},{rows:statuses},{rows:unallocated}]=await Promise.all([
  pool.query(`SELECT i.id::text AS invoice_id,i.source_report_id,i.channel,i.source_reference,i.source_name,i.distributor_code,i.customer_id::text,
   i.invoice_date::text,i.due_date::text,i.source_payment_status,i.amount::text,
   coalesce((SELECT sum(a.amount-coalesce((SELECT sum(v.amount) FROM collections_payment_reversals v WHERE v.allocation_id=a.id),0)) FROM collections_payment_allocations a JOIN collections_payment_receipts p ON p.id=a.payment_id WHERE a.invoice_id=i.id),0)::text AS collected,
   coalesce((SELECT sum(a.amount) FROM collections_invoice_adjustments a WHERE a.invoice_id=i.id),0)::text AS credits,
   coalesce((SELECT sum(a.amount) FROM collections_payment_allocations a WHERE a.invoice_id=i.id),0)::text AS allocated,
   coalesce((SELECT json_agg(json_build_object('allocationId',a.id::text,'reference',p.payment_reference,'receivedOn',p.received_on::text,'verificationReference',p.verification_reference,'amount',a.amount::text,
     'reversed',coalesce((SELECT sum(v.amount) FROM collections_payment_reversals v WHERE v.allocation_id=a.id),0)::text) ORDER BY p.received_on,a.created_at)
    FROM collections_payment_allocations a JOIN collections_payment_receipts p ON p.id=a.payment_id WHERE a.invoice_id=i.id),'[]'::json) AS payment_history
   FROM collections_invoice_records i ORDER BY i.source_report_id,i.channel,i.source_row,i.id`),
  pool.query(`SELECT DISTINCT ON(source_report_id,source_name) id::text,source_report_id,source_name,new_status,customer_id::text
   FROM collections_home_payment_status_changes ORDER BY source_report_id,source_name,id DESC`),
  pool.query(`SELECT p.id::text,p.channel,p.payer_name,p.payment_reference,p.received_on::text,p.amount::text,
   coalesce(sum(a.amount),0)::text AS allocated,(p.amount-coalesce(sum(a.amount),0))::text AS unallocated
   FROM collections_payment_receipts p LEFT JOIN collections_payment_allocations a ON a.payment_id=p.id
   GROUP BY p.id,p.channel,p.payer_name,p.payment_reference,p.received_on,p.amount HAVING p.amount>coalesce(sum(a.amount),0) ORDER BY p.received_on,p.id`)
 ]);
 const invoiceMaps=new Map();
 for(const row of invoices){
  const key=`${row.source_report_id}\u0000${row.channel}\u0000${row.source_reference}`;
  const amount=cents(row.amount),collected=cents(row.collected),credits=cents(row.credits),outstanding=Math.max(0,amount-collected-credits);
  invoiceMaps.set(key,{invoiceId:row.invoice_id,invoiceDate:row.invoice_date,dueDate:row.due_date,collectedAmount:collected/100,creditAmount:credits/100,outstandingAmount:outstanding/100,allocatedAmount:Number(row.allocated),customerId:row.customer_id,sourcePaymentStatus:row.source_payment_status,paymentHistory:row.payment_history||[]});
 }
 const latestStatuses=new Map(statuses.map(s=>[`${s.source_report_id}\u0000${s.source_name}`,s]));
 const reports=sales.reports.map(report=>{
  const decorate=(rows,channel)=>rows.map(r=>{
   const ref=String(r.sourceReference||`source row ${r.row}`),ledger=invoiceMaps.get(`${report.id}\u0000${channel}\u0000${ref}`)||{};
   const manual=channel==='home_customers'?latestStatuses.get(`${report.id}\u0000${r.name}`):null;
   const source=invoiceMaps.get(`${report.id}\u0000${channel}\u0000${ref}`);
   const recorded=source?.sourcePaymentStatus||sourceStatus(r.paymentStatus);
   const computed=Number(ledger.collectedAmount)>0?(ledger.outstandingAmount===0?'Paid':'Unpaid'):null;
   return {...r,...ledger,sourcePaymentStatus:recorded,sourcePaymentStatusRaw:r.paymentStatus??null,manualPaymentStatus:manual?.new_status||null,
    paymentStatus:manual?.new_status||recorded||computed||null,statusRevision:manual?.id||'0',
    statusCustomerId:manual?.customer_id||null};
  });
  return {...report,homes:decorate(report.homes||[],'home_customers'),stores:decorate(report.stores||[],'distributors_stores')};
 });
 return {...sales,...reports[0],reports,unallocatedPayments:unallocated.map(p=>({...p,amount:Number(p.amount),allocated:Number(p.allocated),unallocated:Number(p.unallocated)}))};
}

export function validateHomeStatus(input){
 if(!input||typeof input!=='object')throw problem(400,'Provide a Home Customer status update.');
 if(!/^\d{4}-\d{2}$/.test(input.period||''))throw problem(400,'Choose a valid invoice reporting month.');
 if(typeof input.accountName!=='string'||!input.accountName.trim()||input.accountName.length>250)throw problem(400,'Choose a source account.');
 if(!['Paid','Unpaid'].includes(input.status))throw problem(400,'Payment status must be Paid or Unpaid.');
 if(input.customerId&&(!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.customerId)))throw problem(400,'Choose a valid CMS customer ID.');
 if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.trim().length>1000)throw problem(400,'Provide a reconciliation note between 5 and 1,000 characters.');
 if(typeof input.expectedRevision!=='string'||!/^\d{1,18}$/.test(input.expectedRevision))throw problem(400,'Refresh the account before changing its status.');
 return {...input,accountName:input.accountName.trim(),reason:input.reason.trim()};
}

export async function saveHomeStatus(pool,input,actor){
 const value=validateHomeStatus(input),client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(728410044,hashtext($1))',[`${value.period}:${value.accountName}`]);
  const {rows:[report]}=await client.query('SELECT id FROM collections_sales_reports WHERE reporting_month=$1::date',[`${value.period}-01`]);
  if(!report)throw problem(404,'No invoice report is available for this month.');
  const {rows:accountRows}=await client.query(`SELECT i.source_payment_status,i.amount::text,
   coalesce((SELECT sum(a.amount-coalesce((SELECT sum(v.amount) FROM collections_payment_reversals v WHERE v.allocation_id=a.id),0)) FROM collections_payment_allocations a WHERE a.invoice_id=i.id),0)::text AS collected,
   coalesce((SELECT sum(c.amount) FROM collections_invoice_adjustments c WHERE c.invoice_id=i.id),0)::text AS credits
   FROM collections_invoice_records i WHERE i.source_report_id=$1 AND i.channel='home_customers' AND i.source_name=$2`,[report.id,value.accountName]);
  if(!accountRows.length)throw problem(404,'Home Customer source account was not found.');
  const {rows:[latest]}=await client.query("SELECT id::text,new_status,customer_id::text FROM collections_home_payment_status_changes WHERE source_report_id=$1 AND source_name=$2 ORDER BY id DESC LIMIT 1",[report.id,value.accountName]);
  if((latest?.id||'0')!==value.expectedRevision)throw problem(409,'This status changed in another session. Refresh and try again.');
  const customerId=value.customerId||latest?.customer_id||null;
  if(customerId){const {rows:[customer]}=await client.query('SELECT id FROM customers WHERE id=$1',[customerId]);if(!customer)throw problem(400,'The selected CMS customer no longer exists.');}
  const amount=accountRows.reduce((n,r)=>n+cents(r.amount),0),collected=accountRows.reduce((n,r)=>n+cents(r.collected),0),credits=accountRows.reduce((n,r)=>n+cents(r.credits),0),balance=amount-collected-credits;
  const financialStatus=collected>0?(balance<=0?'Paid':'Unpaid'):null,sourceStatuses=[...new Set(accountRows.map(r=>r.source_payment_status).filter(Boolean))],sourceStatusValue=sourceStatuses.length===1&&accountRows.every(r=>r.source_payment_status)?sourceStatuses[0]:null;
  const previous=latest?.new_status||financialStatus||sourceStatusValue||null;
  const {rows:[saved]}=await client.query(`INSERT INTO collections_home_payment_status_changes(source_report_id,source_name,customer_id,previous_status,new_status,reason,actor)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`,[report.id,value.accountName,customerId,previous,value.status,value.reason,actor]);
  await client.query('COMMIT');return saved;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

export function validatePayment(input){
 if(!input||typeof input!=='object')throw problem(400,'Provide a verified payment and invoice allocations.');
 if(!/^\d{4}-\d{2}$/.test(input.period||''))throw problem(400,'Choose a valid invoice reporting month.');
 if(!['home_customers','distributors_stores'].includes(input.channel))throw problem(400,'Choose a valid Collections channel.');
 if(typeof input.payerName!=='string'||!input.payerName.trim()||input.payerName.length>250)throw problem(400,'Enter the source account name exactly as shown.');
 if(typeof input.paymentReference!=='string'||input.paymentReference.trim().length<2||input.paymentReference.trim().length>200)throw problem(400,'Enter a unique payment reference.');
 if(!isoDate(input.receivedOn))throw problem(400,'Enter a valid payment date.');
 if(typeof input.verificationReference!=='string'||input.verificationReference.trim().length<2||input.verificationReference.trim().length>250)throw problem(400,'Enter the bank or remittance verification reference.');
 const paymentAmount=Number(input.paymentAmount);
 if(!Number.isFinite(paymentAmount)||paymentAmount<=0||paymentAmount!==Math.round(paymentAmount*100)/100)throw problem(400,'Enter a positive receipt amount to two decimal places.');
 if(!Array.isArray(input.allocations)||!input.allocations.length||input.allocations.length>100)throw problem(400,'Allocate the payment to one or more invoice source rows.');
 const seen=new Set(),allocations=input.allocations.map(a=>{
  const amount=Number(a.amount);
  if(typeof a.invoiceId!=='string'||!/^[-\da-f]{36}$/i.test(a.invoiceId)||seen.has(a.invoiceId))throw problem(400,'Choose distinct invoice rows.');
  if(!Number.isFinite(amount)||amount<=0||amount!==Math.round(amount*100)/100)throw problem(400,'Allocation amounts must be positive Kenyan shilling amounts to two decimal places.');
  seen.add(a.invoiceId);return {invoiceId:a.invoiceId,amount};
 });
 const total=allocations.reduce((sum,a)=>sum+cents(a.amount),0);
 if(total>cents(paymentAmount))throw problem(400,'Allocated amounts cannot exceed the verified receipt. The remainder stays unallocated.');
 return {...input,payerName:input.payerName.trim(),paymentReference:input.paymentReference.trim(),verificationReference:input.verificationReference.trim(),allocations,total:total/100,paymentAmount};
}

export async function recordPayment(pool,input,actor){
 const value=validatePayment(input),client=await pool.connect();
 try{
  await client.query('BEGIN');
  const {rows:invoiceRows}=await client.query(`SELECT id::text,source_report_id,channel,source_name,amount::text FROM collections_invoice_records
   WHERE id=ANY($1::uuid[]) ORDER BY id`,[value.allocations.map(a=>a.invoiceId)]);
  if(invoiceRows.length!==value.allocations.length)throw problem(404,'One or more invoice source rows are unavailable.');
  for(const invoice of invoiceRows)await client.query('SELECT pg_advisory_xact_lock(728410047,hashtext($1))',[invoice.id]);
  if(invoiceRows.some(i=>i.channel!==value.channel||i.source_name.toLocaleLowerCase()!==value.payerName.toLocaleLowerCase()))throw problem(400,'Every allocation must belong to this payer and Collections channel.');
  const reportId=invoiceRows[0].source_report_id;
  if(invoiceRows.some(i=>i.source_report_id!==reportId))throw problem(400,'Allocate a payment within one reporting period.');
  const {rows:[cohort]}=await client.query('SELECT reporting_month::text FROM collections_sales_reports WHERE id=$1',[reportId]);
  if(cohort?.reporting_month.slice(0,7)!==value.period)throw problem(400,'Invoice rows do not match the selected reporting period.');
  const {rows:[existing]}=await client.query('SELECT id FROM collections_payment_receipts WHERE payment_reference=$1',[value.paymentReference]);
  if(existing)throw problem(409,'This payment reference has already been recorded.');
  const {rows:[payment]}=await client.query(`INSERT INTO collections_payment_receipts(channel,payer_name,payment_reference,received_on,amount,verification_reference,verified_by,actor)
   VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id::text`,[value.channel,value.payerName,value.paymentReference,value.receivedOn,value.paymentAmount,value.verificationReference,actor]);
  await client.query('SELECT pg_advisory_xact_lock(728410046,hashtext($1))',[payment.id]);
  for(const allocation of value.allocations){
   await client.query('INSERT INTO collections_payment_allocations(payment_id,invoice_id,amount,actor) VALUES($1,$2,$3,$4)',[payment.id,allocation.invoiceId,amountText(allocation.amount),actor]);
  }
  await client.query('COMMIT');return {paymentId:payment.id,allocated:value.total,unallocated:Math.round((value.paymentAmount-value.total)*100)/100};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.code==='23505')throw problem(409,'A payment reference or allocation already exists.');if(/Allocations cannot exceed|Allocation exceeds|channel must match|source account/.test(error.message))throw problem(409,error.message);throw error;}finally{client.release();}
}

export async function allocateUnmatchedPayment(pool,input,actor){
 if(!input||typeof input!=='object'||typeof input.paymentId!=='string'||!/^[-\da-f]{36}$/i.test(input.paymentId))throw problem(400,'Choose a valid unallocated payment.');
 const reason=typeof input.reason==='string'?input.reason.trim():'';
 if(reason.length<5||reason.length>1000)throw problem(400,'Provide an allocation reconciliation note.');
 if(!Array.isArray(input.allocations)||!input.allocations.length||input.allocations.length>100)throw problem(400,'Allocate the receipt to one or more invoice source rows.');
 const seen=new Set(),allocations=input.allocations.map(a=>{const amount=Number(a.amount);if(typeof a.invoiceId!=='string'||!/^[-\da-f]{36}$/i.test(a.invoiceId)||seen.has(a.invoiceId))throw problem(400,'Choose distinct invoice rows.');if(!Number.isFinite(amount)||amount<=0||amount!==Math.round(amount*100)/100)throw problem(400,'Allocation amounts must be positive Kenyan shilling amounts to two decimal places.');seen.add(a.invoiceId);return {invoiceId:a.invoiceId,amount};});
 const total=allocations.reduce((n,a)=>n+cents(a.amount),0)/100,client=await pool.connect();
 try{
  await client.query('BEGIN');
  const {rows:[payment]}=await client.query('SELECT id::text,channel,payer_name,amount::text FROM collections_payment_receipts WHERE id=$1',[input.paymentId]);
  if(!payment)throw problem(404,'Verified payment receipt not found.');
  await client.query('SELECT pg_advisory_xact_lock(728410046,hashtext($1))',[payment.id]);
  const {rows:[allocated]}=await client.query('SELECT coalesce(sum(amount),0)::text AS total FROM collections_payment_allocations WHERE payment_id=$1',[payment.id]);
  const remaining=cents(payment.amount)-cents(allocated.total);if(total>remaining/100)throw problem(409,'New allocations exceed the unallocated receipt balance.');
  const {rows:invoiceRows}=await client.query('SELECT id::text,channel,source_name FROM collections_invoice_records WHERE id=ANY($1::uuid[]) ORDER BY id',[allocations.map(a=>a.invoiceId)]);
  if(invoiceRows.length!==allocations.length)throw problem(404,'One or more invoice rows were not found.');
  for(const invoice of invoiceRows)await client.query('SELECT pg_advisory_xact_lock(728410047,hashtext($1))',[invoice.id]);
  if(invoiceRows.some(i=>i.channel!==payment.channel||i.source_name.toLocaleLowerCase()!==payment.payer_name.toLocaleLowerCase()))throw problem(400,'Allocate only to the same payer and financial channel as the verified receipt.');
  for(const allocation of allocations)await client.query('INSERT INTO collections_payment_allocations(payment_id,invoice_id,amount,actor) VALUES($1,$2,$3,$4)',[payment.id,allocation.invoiceId,amountText(allocation.amount),actor]);
  await client.query('COMMIT');return {paymentId:payment.id,allocated:total,unallocated:Math.round((remaining-total*100))/100};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.code==='23505')throw problem(409,'This receipt is already allocated to one or more selected invoice rows.');if(/Allocations cannot exceed|Allocation exceeds|channel must match|source account/.test(error.message))throw problem(409,error.message);throw error;}finally{client.release();}
}

function validateAdjustment(input){
 if(!input||typeof input!=='object'||typeof input.invoiceId!=='string'||!/^[-\da-f]{36}$/i.test(input.invoiceId))throw problem(400,'Choose a valid invoice row.');
 const amount=Number(input.amount),reference=typeof input.reference==='string'?input.reference.trim():'',reason=typeof input.reason==='string'?input.reason.trim():'';
 if(!Number.isFinite(amount)||amount<=0||amount!==Math.round(amount*100)/100)throw problem(400,'Enter a positive credit amount to two decimal places.');
 if(reference.length<2||reference.length>200)throw problem(400,'Enter the approved credit-note reference.');
 if(reason.length<5||reason.length>1000)throw problem(400,'Provide the credit approval or reconciliation note.');
 return {invoiceId:input.invoiceId,amount,reference,reason};
}
export async function recordCredit(pool,input,actor){
 const value=validateAdjustment(input),client=await pool.connect();
 try{
  await client.query('BEGIN');const {rows:[invoice]}=await client.query('SELECT id::text FROM collections_invoice_records WHERE id=$1',[value.invoiceId]);if(!invoice)throw problem(404,'Invoice row not found.');await client.query('SELECT pg_advisory_xact_lock(728410047,hashtext($1))',[invoice.id]);
  const {rows:[saved]}=await client.query('INSERT INTO collections_invoice_adjustments(invoice_id,adjustment_reference,amount,reason,actor) VALUES($1,$2,$3,$4,$5) RETURNING id::text',[value.invoiceId,value.reference,amountText(value.amount),value.reason,actor]);
  await client.query('COMMIT');return saved;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.code==='23505')throw problem(409,'This credit-note reference is already recorded.');if(/Credit exceeds/.test(error.message))throw problem(409,error.message);throw error;}finally{client.release();}
}
export async function recordPaymentReversal(pool,input,actor){
 if(!input||typeof input!=='object'||typeof input.allocationId!=='string'||!/^[-\da-f]{36}$/i.test(input.allocationId))throw problem(400,'Choose a valid payment allocation.');
 const amount=Number(input.amount),reference=typeof input.reference==='string'?input.reference.trim():'',reason=typeof input.reason==='string'?input.reason.trim():'';
 if(!Number.isFinite(amount)||amount<=0||amount!==Math.round(amount*100)/100)throw problem(400,'Enter a positive reversed amount to two decimal places.');
 if(reference.length<2||reference.length>200||reason.length<5||reason.length>1000)throw problem(400,'Enter a reversal reference and reason.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const {rows:[allocation]}=await client.query('SELECT id::text,invoice_id::text FROM collections_payment_allocations WHERE id=$1',[input.allocationId]);
  if(!allocation)throw problem(404,'Payment allocation not found.');
  await client.query('SELECT pg_advisory_xact_lock(728410047,hashtext($1))',[allocation.invoice_id]);
  await client.query('SELECT pg_advisory_xact_lock(728410048,hashtext($1))',[allocation.id]);
  const {rows:[saved]}=await client.query('INSERT INTO collections_payment_reversals(allocation_id,reversal_reference,amount,reason,actor) VALUES($1,$2,$3,$4,$5) RETURNING id::text',[input.allocationId,reference,amountText(amount),reason,actor]);
  await client.query('COMMIT');return saved;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.code==='23505')throw problem(409,'This reversal reference is already recorded.');if(/Reversal exceeds/.test(error.message))throw problem(409,error.message);throw error;}finally{client.release();}
}

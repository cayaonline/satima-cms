const unavailable=()=>({available:false,reconciled:false,suppliedValue:null,billedValue:null,remittanceValue:null,verifiedCollections:null,outstanding:null,exceptions:null,records:[],branches:[],findings:[],reason:'Awaiting retailer source documents and reconciliation. Naivas is first; Chandarana and other retailers follow.'});
export function summarizeRetail(records,statement,findings){
 const total=rows=>rows.reduce((s,r)=>s+Math.round(Number(r.amount)*100),0)/100;
 const listed=total(records),controls=statement.payload.controls;
 if(records.length!==statement.payload.summary.invoiceRows||listed!==statement.payload.summary.listedInvoices)throw Object.assign(Error('Statement source records are incomplete. Contact your administrator.'),{status:503});
 const start=statement.period_start,end=statement.period_end;
 const within=records.filter(r=>r.date>=start&&r.date<=end),branchNames=[...new Set(records.map(r=>r.branch))];
 return {available:true,reconciled:false,datasetId:statement.dataset_id,retailer:'Naivas',sheet:statement.payload.sheet,periodStart:start,periodEnd:end,
  suppliedValue:null,billedValue:listed,remittanceValue:null,verifiedCollections:null,outstanding:controls.balance,statementPaid:controls.paid,statementInvoiced:controls.invoiced,
  summaryDifference:Math.round((listed-controls.invoiced)*100)/100,invoiceRows:records.length,datedWithinPeriod:total(within),datedOutsidePeriod:total(records.filter(r=>r.date<start||r.date>end)),outsidePeriodRows:records.length-within.length,
  exceptions:findings.filter(f=>f.status==='open').length,records,findings,
  branches:branchNames.map(name=>({name,invoiceRows:records.filter(r=>r.branch===name).length,listedInvoices:total(records.filter(r=>r.branch===name)),flaggedRows:records.filter(r=>r.branch===name&&r.flags.length).length})).sort((a,b)=>b.listedInvoices-a.listedInvoices||a.name.localeCompare(b.name)),
  reason:'Naivas statement imported for review. Listed invoices and statement-reported balances are not delivery-verified or bank-reconciled. Chandarana and other retailers await separate sources.'};
}
export async function retailData(pool){
 const {rows:[statement]}=await pool.query("SELECT dataset_id,period_start::text,period_end::text,payload FROM collections_retail_statements WHERE retailer_code='naivas' ORDER BY period_end DESC,dataset_id LIMIT 1");
 if(!statement)return unavailable();
 const [records,findings]=await Promise.all([
  pool.query("SELECT source_row AS row,branch_code AS branch,purchase_order AS \"purchaseOrder\",document_reference AS invoice,event_date::text AS date,due_date::text AS \"dueDate\",amount::float8 AS amount,source_reference AS \"sourceReference\",raw_source AS raw,quality_flags AS flags FROM collections_retail_records WHERE dataset_id=$1 AND retailer_code='naivas' AND kind='invoice' ORDER BY source_row",[statement.dataset_id]),
  pool.query('SELECT code,source_rows AS rows,description,source_reference AS "sourceReference",status FROM collections_retail_exceptions WHERE dataset_id=$1 ORDER BY source_rows,code',[statement.dataset_id])
 ]);
 return summarizeRetail(records.rows,statement,findings.rows);
}
export function filterRetail(records,params){
 const sort=params.get('sort')||'row',q=(params.get('q')||'').toLocaleLowerCase(),branch=params.get('branch')||'',flag=params.get('flag')||'';
 return records.filter(r=>(!branch||r.branch===branch)&&(!flag||flag==='flagged'&&r.flags.length>0||r.flags.includes(flag))&&[r.branch,r.invoice,r.purchaseOrder,String(r.row)].some(v=>v.toLocaleLowerCase().includes(q))).sort((a,b)=>sort==='amountDesc'?b.amount-a.amount||a.row-b.row:sort==='date'?a.date.localeCompare(b.date)||a.row-b.row:a.row-b.row);
}
export function retailCsv(data,params){
 const cell=v=>'"'+String(typeof v==='string'&&/^[\s]*[=+@\-\t\r]/.test(v)?"'"+v:v??'').replaceAll('"','""')+'"';
 const rows=filterRetail(data.records,params);
 return '\ufeff'+[['Dataset','Source_Reference','Source_Row','Store','Purchase_Order_Original','Invoice_Reference','Invoice_Date_As_Recorded','Due_Date_As_Recorded','Listed_Invoice_KES','Source_Date_Cell','Source_Details_Cell','Review_Flags'],...rows.map(r=>[data.datasetId,r.sourceReference,r.row,r.branch,r.purchaseOrder,r.invoice,r.date,r.dueDate,r.amount,r.raw.A.value,r.raw.E.value,r.flags.join('; ')])].map(row=>row.map(cell).join(',')).join('\r\n');
}

export async function salesData(pool){
 const {rows}=await pool.query('SELECT id,reporting_month,payload FROM collections_sales_reports ORDER BY reporting_month DESC,id');
 if(!rows.length)return {available:false,homes:[],stores:[],summary:null,reports:[]};
 const reports=rows.map(row=>({available:true,id:row.id,...row.payload,sourceCells:undefined,sourceFilename:row.payload.sourceFilename||({'october-sales-2026':'October Invoices.xlsx','sales-2026-07':'July Invoices.xls','sales-2026-08':'August Invoices.xls','sales-2026-09':'September Invoices.xls'}[row.id]||'Invoice source'),reportingMonth:String(row.reporting_month).slice(0,7),collected:null,outstanding:null,overdue:null}));
 return {...reports[0],reports};
}
export function salesCsv(data,params){
 data=data.reports?.find(r=>r.reportingMonth===params.get('period'))||data;
 const channel=params.get('channel')||'all',q=(params.get('q')||'').toLocaleLowerCase(),code=params.get('distributor')||'';
 const records=[...data.homes,...data.stores].filter(r=>(channel==='all'||r.channel===channel)&&(!code||r.code===code)&&[r.name,r.displayName||''].some(n=>n.toLocaleLowerCase().includes(q)));
 const cell=v=>'"'+String(typeof v==='string'&&/^[\s]*[=+@\-\t\r]/.test(v)?"'"+v:v??'').replaceAll('"','""')+'"';
 return '\ufeff'+[['Source_File','Source_Reference','Channel','Source_Name','Distributor_Name','Invoice_Amount_KES','Report_Period','Invoice_Date','Due_Date','Payment_Status'],...records.map(r=>[data.sourceFilename,r.sourceReference,r.channel,r.name,r.displayName||'',r.amount,data.period,'','','Unknown'])].map(row=>row.map(cell).join(',')).join('\r\n');
}

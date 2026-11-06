export async function salesData(pool){
 const {rows:[row]}=await pool.query('SELECT id,payload FROM collections_sales_reports ORDER BY reporting_month DESC,id LIMIT 1');
 if(!row)return {available:false,homes:[],stores:[],summary:null};
 return {available:true,id:row.id,...row.payload,sourceCells:undefined,sourceFilename:'October Invoices.xlsx',collected:null,outstanding:null,overdue:null};
}
export function salesCsv(data,params){
 const channel=params.get('channel')||'all',q=(params.get('q')||'').toLocaleLowerCase(),code=params.get('distributor')||'';
 const records=[...data.homes,...data.stores].filter(r=>(channel==='all'||r.channel===channel)&&(!code||r.code===code)&&[r.name,r.displayName||''].some(n=>n.toLocaleLowerCase().includes(q)));
 const cell=v=>'"'+String(typeof v==='string'&&/^[\s]*[=+@\-\t\r]/.test(v)?"'"+v:v??'').replaceAll('"','""')+'"';
 return '\ufeff'+[['Source_File','Source_Reference','Channel','Source_Name','Distributor_Name','Invoice_Amount_KES','Report_Period','Invoice_Date','Due_Date','Payment_Status'],...records.map(r=>[data.sourceFilename,r.sourceReference,r.channel,r.name,r.displayName||'',r.amount,data.period,'','','Unknown'])].map(row=>row.map(cell).join(',')).join('\r\n');
}

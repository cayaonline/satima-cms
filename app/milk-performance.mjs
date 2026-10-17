import {Problem} from './store.mjs';

export const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
export const metrics=[
 ['Milk Collection','Farmers Milk Supply','farmers_milk_supply_liters','flow'],
 ['Milk Processing','Milk Available for Pasteurization','available_for_pasteurization_liters','flow'],
 ['Milk Processing','Pstd + Inc + CF (reported)','pstd_inc_cf_reported_total_liters','flow'],
 ['Milk Distribution','Milk Out — Stores','milk_out_stores_liters','flow'],
 ['Milk Distribution','Milk Out — Homes','milk_out_homes_liters','flow'],
 ['Milk Distribution','Raw Milk Out','milk_out_raw_liters','flow'],
 ['Milk Distribution','Total Milk Out','total_milk_out_liters','flow'],
 ['Milk Distribution','Source-Reported Total Sales','total_sales_source_liters','flow'],
 ['Returns and Inventory','Returns','returns_liters','flow'],
 ['Returns and Inventory','Return Percentage','return_rate_source_fraction','rate'],
 ['Returns and Inventory','Rescued','rescued_liters','flow'],
 ['Returns and Inventory','In-House','inhouse_liters','latest'],
 ['Returns and Inventory','R&D','rnd_liters','flow'],
 ['Returns and Inventory','Carry Forward — Pasteurized','carry_forward_pasteurized_liters','latest'],
 ['Returns and Inventory','Carry Forward — Raw','carry_forward_raw_liters','latest']
].map(([group,label,key,aggregation])=>({group,label,key,aggregation}));
export const numericKeys=[...new Set([...metrics.map(x=>x.key),'pstd_inc_cf_calculated_components_liters'])];
const dbKeys=['farmers_milk_supply_liters','available_for_pasteurization_liters','pstd_inc_cf_reported_total_liters','pstd_inc_cf_calculated_components_liters','milk_out_stores_liters','milk_out_homes_liters','milk_out_raw_liters','total_milk_out_liters','returns_liters','return_rate_source_fraction','total_sales_source_liters','rescued_liters','inhouse_liters','rnd_liters','carry_forward_pasteurized_liters','carry_forward_raw_liters'];
export {dbKeys};
const scale=1000000000000000000n;
export function units(value){if(value===null||value===undefined)return null;const s=String(value).trim();if(!s)return null;if(!/^\d+(?:\.\d{1,18})?$/.test(s))throw new Error('Invalid nonnegative source number');const [a,b='']=s.split('.');return BigInt(a)*scale+BigInt(b.padEnd(18,'0'));}
export function decimal(value){if(value===null)return null;const negative=value<0n;let s=(negative?-value:value).toString().padStart(19,'0'),whole=s.slice(0,-18),fraction=s.slice(-18).replace(/0+$/,'');return (negative?'-':'')+whole+(fraction?'.'+fraction:'');}
export function parseCsv(source){
 const rows=[];let row=[],field='',quoted=false;const text=source.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw new Error('Unclosed CSV quote');if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
 const header=rows.shift();if(!header||new Set(header).size!==header.length)throw new Error('Invalid CSV header');
 return rows.filter(r=>r.some(x=>x!=='')).map((r,i)=>{if(r.length!==header.length)throw new Error('Invalid CSV column count at data row '+(i+1));return Object.fromEntries(header.map((h,j)=>[h,r[j]]));});
}
export function expressionComponents(expression){const lhs=expression?.split('=')[0]?.replace(/,/g,'').trim();if(!lhs||!/^\s*\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)*\s*$/.test(lhs))return null;return lhs.split('+').reduce((sum,p)=>sum+units(p.trim()),0n);}
export function normalizedWeeks(rows,workbook){
 if(!rows.length)throw new Error('No weekly performance rows');const seen=new Set();
 return rows.map(raw=>{
  const year=Number(raw.report_year),month=months.indexOf(raw.report_month)+1,week=Number(raw.week_number),row=Number(raw.source_row);
  if(!Number.isInteger(year)||year<2020||year>2200||!month||!Number.isInteger(week)||week<1||week>6||!Number.isInteger(row)||row<1)throw new Error('Invalid source reporting identity');
  const key=`${year}-${month}-${week}`;if(seen.has(key))throw new Error('Duplicate reported week '+key);seen.add(key);
  if(!raw.source_worksheet||!raw.source_week_label)throw new Error('Missing source reference');
  const cells=workbook?.[row]||null;
  if(workbook&&!cells)throw new Error('Workbook row missing: '+row);
  if(cells&&String(cells.A?.value??'').trim()!==raw.source_week_label.trim())throw new Error('Week label differs from workbook at row '+row);
  const original=raw.pstd_inc_cf_source_expression?.trim()||null;
  if(cells&&String(cells.D?.value??'').trim()!==original)throw new Error('Pasteurization expression differs from workbook at row '+row);
  const columnMap={farmers_milk_supply_liters:'B',available_for_pasteurization_liters:'C',milk_out_stores_liters:'E',milk_out_homes_liters:'F',milk_out_raw_liters:'G',total_milk_out_liters:'H',returns_liters:'I',return_rate_source_fraction:'J',total_sales_source_liters:'K',rescued_liters:'L',inhouse_liters:'M',rnd_liters:'N',carry_forward_pasteurized_liters:'O',carry_forward_raw_liters:'P'};
  for(const [metric,col] of Object.entries(columnMap))if(cells){const workbookValue=cells[col]?.value??null;const csvValue=raw[metric]?.trim()||null;const workbookUnits=workbookValue&&/[eE]/.test(workbookValue)?units(Number(workbookValue).toFixed(18)):units(workbookValue),csvUnits=units(csvValue);if((workbookUnits===null)!==(csvUnits===null)||workbookUnits!==null&&((workbookUnits>csvUnits?workbookUnits-csvUnits:csvUnits-workbookUnits)>(metric==='return_rate_source_fraction'?1000n:0n)))throw new Error('Normalized value differs from workbook at row '+row+' column '+col);}
  const values=Object.fromEntries(dbKeys.map(k=>[k,raw[k]?.trim()?decimal(units(raw[k])):null]));
  const components=expressionComponents(original);
  if(components!==null){if(values.pstd_inc_cf_calculated_components_liters!==null&&units(values.pstd_inc_cf_calculated_components_liters)!==components)throw new Error('Normalized expression-component result differs from source expression at row '+row);values.pstd_inc_cf_calculated_components_liters=decimal(components);}
  return {year,month,week,row,source_worksheet:raw.source_worksheet,source_week_label:raw.source_week_label,original_expression:original,values,raw,workbook_cells:cells,issues:detectIssues({...values,original_expression:original})};
 });
}
export function detectIssues(v){
 const n=k=>units(v[k]),issue=(metric,reported,calculated,note)=>({metric,reported_value:decimal(reported),calculated_value:decimal(calculated),difference:decimal(reported-calculated),severity:'warning',note});const issues=[];
 const stores=n('milk_out_stores_liters'),homes=n('milk_out_homes_liters'),out=n('total_milk_out_liters'),returns=n('returns_liters'),sales=n('total_sales_source_liters'),rate=n('return_rate_source_fraction');
 if(stores!==null&&homes!==null&&out!==null&&stores+homes!==out)issues.push(issue('total_milk_out_liters',out,stores+homes,'Reported total differs from stores plus homes; raw is separate.'));
 if(out!==null&&returns!==null&&sales!==null&&sales!==out-returns)issues.push(issue('total_sales_source_liters',sales,out-returns,'Reported net sales differs from milk out less returns.'));
 if(out&&returns!==null&&rate!==null){const calculated=returns*scale/out;if((rate>calculated?rate-calculated:calculated-rate)>500000000000000n)issues.push(issue('return_rate_source_fraction',rate,calculated,'Reported return percentage differs materially from returns divided by milk out.'));}
 const calculated=expressionComponents(v.original_expression),reported=n('pstd_inc_cf_reported_total_liters');if(calculated!==null&&reported!==null&&reported!==calculated)issues.push(issue('pstd_inc_cf_reported_total_liters',reported,calculated,'Reported pasteurization result differs from its expression components.'));
 return issues;
}
export function monthlyView(records){
 const weeks=[...records].sort((a,b)=>a.week_number-b.week_number);const contiguous=weeks.length>0&&weeks.every((w,i)=>w.week_number===i+1),result={};
 for(const metric of metrics){const vals=weeks.map(r=>r[metric.key]);let value=null,complete=contiguous&&vals.every(v=>v!==null&&v!==undefined);
  if(metric.aggregation==='latest'){const latest=[...vals].reverse().find(v=>v!==null&&v!==undefined);value=latest??null;complete=vals.at(-1)!==null&&vals.at(-1)!==undefined;}
  else if(metric.aggregation==='rate'){const out=monthlyViewFlow(weeks,'total_milk_out_liters'),ret=monthlyViewFlow(weeks,'returns_liters');complete=contiguous&&out!==null&&ret!==null;value=complete&&units(out)>0n?decimal(units(ret)*scale/units(out)):null;}
  else value=complete?decimal(vals.reduce((sum,v)=>sum+units(v),0n)):null;
  result[metric.key]={value,complete,aggregation:metric.aggregation};
 }
 return result;
}
function monthlyViewFlow(weeks,key){const vals=weeks.map(r=>r[key]);return vals.every(v=>v!==null&&v!==undefined)?decimal(vals.reduce((sum,v)=>sum+units(v),0n)):null;}
export async function performanceReport(db,params,{admin=false}={}){
 const {rows:available}=await db.query(`SELECT report_year,report_month,count(*)::int AS weeks FROM milk_performance_weeks WHERE is_current GROUP BY report_year,report_month ORDER BY report_year DESC,report_month DESC`);
 const monthsAvailable=available.map(r=>({year:r.report_year,month:r.report_month,label:`${months[r.report_month-1]} ${r.report_year}`,weeks:r.weeks}));
 if(!monthsAvailable.length)return {months:[],selected:null,records:[],totals:null,metrics,issue_count:0};
 if(params.has('from')||params.has('to'))throw new Problem(400,'Historical weeks have no verified calendar dates; custom date filtering is unavailable.');
 const selectedValue=params.get('month')||`${available[0].report_year}-${String(available[0].report_month).padStart(2,'0')}`;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedValue))throw new Problem(400,'Invalid historical month.');
 const [year,month]=selectedValue.split('-').map(Number);
 if(!available.some(r=>r.report_year===year&&r.report_month===month))throw new Problem(404,'Historical month not available.');
 const {rows}=await db.query(`SELECT w.id,w.report_year,w.report_month,w.week_number,w.source_row,w.source_week_label,w.revision,w.week_start,w.week_end,w.original_pasteurization_expression,${dbKeys.map(k=>`w.${k}::text`).join(',')},b.source_filename,b.source_sha256,b.source_worksheet,b.imported_at FROM milk_performance_weeks w JOIN milk_performance_import_batches b ON b.id=w.import_batch_id WHERE w.is_current AND w.report_year=$1 AND w.report_month=$2 ORDER BY w.week_number`,[year,month]);
 const {rows:issues}=await db.query(`SELECT i.week_id,i.metric,i.reported_value::text,i.calculated_value::text,i.difference::text,i.note,i.review_status FROM milk_performance_issues i JOIN milk_performance_weeks w ON w.id=i.week_id WHERE w.is_current AND w.report_year=$1 AND w.report_month=$2 ORDER BY w.week_number,i.id`,[year,month]);
 const byWeek=new Map();for(const issue of issues){const a=byWeek.get(issue.week_id)||[];a.push(issue);byWeek.set(issue.week_id,a);}
 const records=rows.map(r=>{const {source_filename,source_sha256,source_worksheet,imported_at,id,...publicRecord}=r;const issues=byWeek.get(id)||[];return {...publicRecord,...(admin?{source_filename,source_sha256,source_worksheet,source_week_id:id,imported_at,issues}:{issue_count:issues.length})};});
 return {months:monthsAvailable,selected:{year,month,label:`${months[month-1]} ${year}`,weeks:records.length},records,totals:monthlyView(records),metrics,issue_count:issues.length,source_kind:'Historical weekly workbook report; separate from operational transactions'};
}

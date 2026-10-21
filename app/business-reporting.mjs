import {performanceReport,monthlyView,months} from './milk-performance.mjs';

// Source weeks have no verified dates. Only an entire calendar month can use
// their aggregate values; a day or partial-month range remains transactional.
export function completeMonth(from,to){
 if(!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(from||''))return null;
 const [year,month]=from.slice(0,7).split('-').map(Number);
 const end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
 return to===end?from.slice(0,7):null;
}

export async function businessReport(db,from,to){
 const month=completeMonth(from,to);
 if(!month)return {source:'operations',month:null,report:null,reason:'Historical weeks cannot be divided into verified calendar days.'};
 const {rows:[available]}=await db.query('SELECT 1 FROM milk_performance_weeks WHERE is_current AND report_year=$1 AND report_month=$2 LIMIT 1',month.split('-').map(Number));
 if(!available)return {source:'operations',month,report:null,reason:'No historical aggregate is imported for this month.'};
 const report=await performanceReport(db,new URLSearchParams({month}));
 return {source:'historical',month,report,reason:'Source-reported business actuals; individual operations remain separate.'};
}

export async function historicalSupplyMonths(db){
 const {rows}=await db.query('SELECT report_year,report_month,week_number,farmers_milk_supply_liters::text FROM milk_performance_weeks WHERE is_current ORDER BY report_year,report_month,week_number');
 const grouped=new Map();for(const row of rows){const key=`${row.report_year}-${String(row.report_month).padStart(2,'0')}`;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);}
 return [...grouped].map(([month,weeks])=>({month,label:`${months[Number(month.slice(5))-1]} ${month.slice(0,4)}`,liters:monthlyView(weeks).farmers_milk_supply_liters.value}));
}

export async function latestBusinessMonth(db){
 const {rows:[row]}=await db.query(`SELECT max(month)::text AS month FROM (
  SELECT make_date(report_year,report_month,1) AS month FROM milk_performance_weeks WHERE is_current
  UNION ALL SELECT date_trunc('month',date_received)::date FROM milk_collections
  UNION ALL SELECT date_trunc('month',inspected_on)::date FROM milk_quality_checks
  UNION ALL SELECT date_trunc('month',processed_on)::date FROM milk_processing_batches
  UNION ALL SELECT date_trunc('month',distributed_on)::date FROM milk_distributions
 ) reporting`);
 return row?.month?.slice(0,7)||null;
}

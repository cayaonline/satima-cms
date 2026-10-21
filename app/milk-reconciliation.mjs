// Compare reported weeks to transactions only when their dates and meanings align.
const scale=1000000n;
const fixed=value=>{if(value===null||value===undefined)return null;const match=String(value).match(/^(\d+)(?:\.(\d{1,6}))?$/);if(!match)throw new Error('Invalid milk quantity');return BigInt(match[1])*scale+BigInt((match[2]||'').padEnd(6,'0'));};
const decimal=value=>{const negative=value<0n,s=(negative?-value:value).toString().padStart(7,'0');return `${negative?'-':''}${s.slice(0,-6)}.${s.slice(-6)}`;};
const dateText=value=>value instanceof Date?value.toISOString().slice(0,10):String(value||'').slice(0,10);
export function periodCoverage(records,year,month){
 if(!records.length||records.some(row=>!row.week_start||!row.week_end))return false;
 const sorted=[...records].sort((a,b)=>dateText(a.week_start).localeCompare(dateText(b.week_start)));
 const start=`${year}-${String(month).padStart(2,'0')}-01`;
 const end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
 if(dateText(sorted[0].week_start)!==start||dateText(sorted.at(-1).week_end)!==end)return false;
 return sorted.every((row,index)=>index===0||new Date(dateText(sorted[index-1].week_end)+'T00:00:00Z').getTime()+86400000===new Date(dateText(row.week_start)+'T00:00:00Z').getTime());
}
export function reconcileMetric({reported,recorded,recordCount,sourceComplete,periodCompatible,definitionCompatible,sourceIssues=0}){
 const base={reported_liters:reported??null,recorded_liters:recordCount?recorded:null,record_count:recordCount,source_complete:sourceComplete,period_compatible:periodCompatible,definition_compatible:definitionCompatible,source_issue_count:sourceIssues,difference_liters:null};
 if(!sourceComplete||reported===null)return {...base,status:'incomplete',reason:'The historical source is missing required weekly figures.'};
 if(!recordCount)return {...base,status:'incomplete',reason:'No matching operational transactions have been recorded.'};
 if(!periodCompatible)return {...base,status:'not_comparable',reason:'Historical weeks do not have verified dates covering this calendar month.'};
 if(!definitionCompatible)return {...base,status:'not_comparable',reason:'The source measure is not confirmed equivalent to the operational measure.'};
 const difference=fixed(reported)-fixed(recorded);
 return {...base,difference_liters:decimal(difference),status:difference===0n?'reconciled':'difference_detected',reason:difference===0n?'Reported and recorded volumes agree.':'Reported and recorded volumes differ.'};
}
export async function reconciliationReport(db,{year,month,records,totals,issueMetrics={}}){
 const start=`${year}-${String(month).padStart(2,'0')}-01`,next=month===12?`${year+1}-01-01`:`${year}-${String(month+1).padStart(2,'0')}-01`;
 const {rows:[ops]}=await db.query(`SELECT
  (SELECT count(*)::int FROM milk_collections WHERE date_received >= $1 AND date_received < $2) AS collection_count,
  (SELECT coalesce(sum(quantity_liters),0)::text FROM milk_collections WHERE date_received >= $1 AND date_received < $2) AS collected_liters,
  (SELECT count(*)::int FROM milk_processing_batches WHERE processed_on >= $1 AND processed_on < $2) AS batch_count,
  (SELECT coalesce(sum(processed_liters),0)::text FROM milk_processing_batches WHERE processed_on >= $1 AND processed_on < $2) AS processed_liters,
  (SELECT count(*)::int FROM milk_distributions WHERE distributed_on >= $1 AND distributed_on < $2 AND status IN ('dispatched','delivered')) AS dispatch_count,
  (SELECT coalesce(sum(quantity_liters),0)::text FROM milk_distributions WHERE distributed_on >= $1 AND distributed_on < $2 AND status IN ('dispatched','delivered')) AS dispatched_liters,
  (SELECT count(*)::int FROM milk_distributions WHERE distributed_on >= $1 AND distributed_on < $2 AND status IN ('dispatched','delivered') AND recipient_type='customer') AS home_count,
  (SELECT count(*)::int FROM milk_distributions WHERE distributed_on >= $1 AND distributed_on < $2 AND status IN ('dispatched','delivered') AND recipient_type='distributor') AS store_count,
  (SELECT coalesce(sum(quantity_liters),0)::text FROM milk_distributions WHERE distributed_on >= $1 AND distributed_on < $2 AND status IN ('dispatched','delivered') AND recipient_type='customer') AS home_liters,
  (SELECT coalesce(sum(quantity_liters),0)::text FROM milk_distributions WHERE distributed_on >= $1 AND distributed_on < $2 AND status IN ('dispatched','delivered') AND recipient_type='distributor') AS store_liters`,[start,next]);
 const datesVerified=periodCoverage(records,year,month);
 const entry=(key,recorded,count,definitionCompatible=false)=>reconcileMetric({reported:totals[key].value,recorded,recordCount:count,sourceComplete:totals[key].complete,periodCompatible:datesVerified,definitionCompatible,sourceIssues:issueMetrics[key]||0});
 return {operational_period:{from:start,to_exclusive:next,description:'Calendar-month transaction context; not a reconciliation unless source weeks cover the same dates.'},historical_dates_verified:datesVerified,
  collection:entry('farmers_milk_supply_liters',ops.collected_liters,ops.collection_count,true),
  processing:entry('available_for_pasteurization_liters',ops.processed_liters,ops.batch_count),
  distribution:entry('total_milk_out_liters',ops.dispatched_liters,ops.dispatch_count),
  destinations:{stores:entry('milk_out_stores_liters',ops.store_liters,ops.store_count),homes:entry('milk_out_homes_liters',ops.home_liters,ops.home_count)},
  raw:{status:'not_comparable',reason:'Raw milk movement is not recorded as a distinct operational distribution type.',reported_liters:totals.milk_out_raw_liters.value,recorded_liters:null,difference_liters:null}};
}

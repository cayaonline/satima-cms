import {Problem} from './store.mjs';

export function reportingPeriod(params, today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())) {
 const period=params.get('period')||'custom';
 if(!['today','week','month','custom'].includes(period))throw new Problem(400,'Choose a valid reporting period.');
 const base=new Date(today+'T12:00:00Z');
 const iso=d=>d.toISOString().slice(0,10);
 let from=period==='custom'?(params.get('from')||'2026-09-01'):today,to=period==='custom'?(params.get('to')||'2026-09-30'):today;
 if(period==='week'){const d=new Date(base);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));from=iso(d);}
 if(period==='month')from=today.slice(0,7)+'-01';
 const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&iso(new Date(s+'T12:00:00Z'))===s;
 if(!valid(from)||!valid(to)||from>to||to>today||Date.parse(to)-Date.parse(from)>366*86400000)throw new Problem(400,'Choose a valid range of up to one year ending today.');
 return {period,from,to};
}

export async function homeSummary(db,params){
 const range=reportingPeriod(params),dates=[range.from,range.to];
 const [network,operations,trend]=await Promise.all([
  db.query(`SELECT
   (SELECT count(*)::int FROM farmers WHERE record_kind='registered' AND master_list_status='current') AS farmers,
   (SELECT count(*)::int FROM customers) AS customers,
   (SELECT count(*)::int FROM distributors WHERE record_type='distributor') AS distributors,
   (SELECT count(*)::int FROM distributors WHERE record_type='store') AS stores`,[]),
  db.query(`SELECT
   (SELECT count(*)::int FROM milk_collections WHERE date_received BETWEEN $1::date AND $2::date) AS collection_records,
   (SELECT coalesce(sum(quantity_liters),0) FROM milk_collections WHERE date_received BETWEEN $1::date AND $2::date) AS collected_liters,
   (SELECT count(*)::int FROM milk_quality_checks WHERE inspected_on BETWEEN $1::date AND $2::date) AS quality_records,
   (SELECT coalesce(sum(accepted_liters),0) FROM milk_quality_checks WHERE inspected_on BETWEEN $1::date AND $2::date) AS accepted_liters,
   (SELECT coalesce(sum(rejected_liters),0) FROM milk_quality_checks WHERE inspected_on BETWEEN $1::date AND $2::date) AS rejected_liters,
   (SELECT count(*)::int FROM milk_processing_batches WHERE processed_on BETWEEN $1::date AND $2::date) AS batch_records,
   (SELECT coalesce(sum(processed_liters),0) FROM milk_processing_batches WHERE processed_on BETWEEN $1::date AND $2::date) AS processed_liters,
   (SELECT coalesce(sum(quantity_liters),0) FROM milk_distributions WHERE distributed_on BETWEEN $1::date AND $2::date AND status IN ('dispatched','delivered')) AS dispatched_liters,
   (SELECT count(*)::int FROM milk_distributions WHERE distributed_on BETWEEN $1::date AND $2::date AND status IN ('dispatched','delivered')) AS dispatch_records,
   (SELECT coalesce(sum(d.quantity_liters),0) FROM milk_distributions d WHERE d.distributed_on BETWEEN $1::date AND $2::date AND d.status IN ('dispatched','delivered') AND d.recipient_type='customer') AS customer_liters,
   (SELECT coalesce(sum(d.quantity_liters),0) FROM milk_distributions d WHERE d.distributed_on BETWEEN $1::date AND $2::date AND d.status IN ('dispatched','delivered') AND d.recipient_type='distributor') AS store_liters,
   (SELECT count(*)::int FROM milk_collections c LEFT JOIN milk_quality_checks q ON q.collection_id=c.id WHERE c.date_received BETWEEN $1::date AND $2::date AND q.id IS NULL) AS pending_quality,
   (SELECT count(*)::int FROM milk_quality_checks WHERE inspected_on BETWEEN $1::date AND $2::date AND rejected_liters>0) AS rejected_checks,
   (SELECT coalesce(sum(greatest(0,q.accepted_liters-coalesce((SELECT sum(a.quantity_liters) FROM milk_batch_allocations a WHERE a.collection_id=q.collection_id),0))),0) FROM milk_quality_checks q WHERE q.inspected_on BETWEEN $1::date AND $2::date) AS accepted_unallocated_liters,
   (SELECT count(*)::int FROM milk_distributions WHERE status='draft') AS draft_distributions`,dates),
  db.query(`WITH daily AS (
   SELECT date_received AS day,sum(quantity_liters) AS collected,0::numeric AS accepted,0::numeric AS rejected,0::numeric AS processed FROM milk_collections WHERE date_received BETWEEN $1::date AND $2::date GROUP BY 1
   UNION ALL SELECT inspected_on,0,sum(accepted_liters),sum(rejected_liters),0 FROM milk_quality_checks WHERE inspected_on BETWEEN $1::date AND $2::date GROUP BY 1
   UNION ALL SELECT processed_on,0,0,0,sum(processed_liters) FROM milk_processing_batches WHERE processed_on BETWEEN $1::date AND $2::date GROUP BY 1)
   SELECT day::text,sum(collected) AS collected_liters,sum(accepted) AS accepted_liters,sum(rejected) AS rejected_liters,sum(processed) AS processed_liters FROM daily GROUP BY day ORDER BY day DESC LIMIT 31`,dates)
 ]);
 return {range,network:network.rows[0],operations:operations.rows[0],trend:trend.rows.reverse(),date:new Intl.DateTimeFormat('en-KE',{timeZone:'Africa/Nairobi',dateStyle:'full'}).format(new Date()),note:'Each stage is counted by its own recorded date; period totals are not one reconciled milk cohort.'};
}

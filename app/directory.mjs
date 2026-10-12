import {Problem,farmerCategories,farmerGenders} from './store.mjs';
const sorts={customer_id:"substring(f.customer_id from 6)::numeric",full_name:'lower(f.full_name)',registration_date:'f.registration_date',status:'f.status::text',created_at:'f.created_at'};
const statuses=['pending_verification','active','inactive','suspended'];
const escapeLike=s=>s.replace(/[\\%_]/g,'\\$&');
export function directoryQuery(params){
 const integer=(name,fallback,max)=>{const v=params.get(name);if(v===null)return fallback;if(!/^[1-9]\d*$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)>max)throw new Problem(400,'Invalid '+name);return Number(v);};
 const page=integer('page',1,1000000),pageSize=integer('page_size',50,500);
 const scope=params.get('scope')||'registered',status=params.get('status')||'',review=params.get('review')||'all';
 const category=params.get('category')||'',registration=params.get('registration')||'',gender=params.get('gender')||'';
 const sort=params.get('sort')||'customer_id',direction=params.get('direction')||(sort==='created_at'?'desc':'asc');
 if(!['registered','all'].includes(scope)||status&&!statuses.includes(status)||category&&!['unassigned',...farmerCategories].includes(category)||registration&&!['registered','not_registered','review_required'].includes(registration)||gender&&!farmerGenders.includes(gender)||!['all','open','clear'].includes(review)||!Object.hasOwn(sorts,sort)||!['asc','desc'].includes(direction))throw new Problem(400,'Invalid directory filter or sort');
 const q=(params.get('q')||'').trim();if(q.length>100)throw new Problem(400,'Search must be at most 100 characters');
 const values=[],conditions=[];const bind=v=>{values.push(v);return '$'+values.length;};
 if(scope!=='all')conditions.push('f.record_kind='+bind(scope));
 if(category)conditions.push(category==='unassigned'?'f.category IS NULL':'f.category='+bind(category));
 if(registration)conditions.push('f.registration_status='+bind(registration));
 if(gender)conditions.push('f.gender='+bind(gender));
 if(status)conditions.push('f.status='+bind(status)+'::farmer_status');
 for(const field of ['county','location']){const v=params.get(field);if(v){if(v.length>300)throw new Problem(400,'Invalid location filter');conditions.push('lower(f.'+field+')=lower('+bind(v.trim())+')');}}
 if(review!=='all')conditions.push((review==='clear'?'NOT ':'')+"EXISTS(SELECT FROM farmer_data_issues i WHERE i.farmer_id=f.id AND i.status='open')");
 const count="(SELECT count(*)::int FROM farmer_data_issues i WHERE i.farmer_id=f.id AND i.status='open')";
 if(q){const noteCount=q.match(/^(\d+)\s+open$/i);if(noteCount)conditions.push(count+'='+bind(Number(noteCount[1])));
 else if(/^open$/i.test(q))conditions.push(count+'>0');
 else if(/^no open notes$/i.test(q))conditions.push(count+'=0');
 else{const p=bind('%'+escapeLike(q.toLowerCase())+'%'),genderTerm=q.toLowerCase().replaceAll(' ','_');const dateMatch=/^\d{4}-\d{2}-\d{2}$/.test(q)&&!Number.isNaN(Date.parse(q))&&new Date(q).toISOString().slice(0,10)===q;conditions.push('(f.search_text LIKE '+p+" ESCAPE E'\\\\' OR lower(coalesce(f.kra_pin,'')) LIKE "+p+" ESCAPE E'\\\\'"+(farmerGenders.includes(genderTerm)?' OR f.gender='+bind(genderTerm):'')+(dateMatch?' OR f.registration_date='+bind(q)+'::date':'')+')');}}
 const order=sorts[sort]+' '+direction+' NULLS LAST,f.id '+direction;
 const limit=bind(pageSize),offset=bind((page-1)*pageSize);
 const sql=`WITH filtered AS MATERIALIZED (SELECT f.* FROM farmers f WHERE ${conditions.join(' AND ')||'true'}),
 stats AS (SELECT count(*)::int AS total,
 count(*) FILTER(WHERE registration_status='registered' AND record_kind='registered')::int AS registered,
 count(*) FILTER(WHERE registration_status<>'registered' AND record_kind='registered')::int AS not_registered,
 count(*) FILTER(WHERE registration_status='review_required' AND record_kind='registered')::int AS review_required,
 count(*) FILTER(WHERE category IS NULL AND record_kind='registered')::int AS uncategorized,
 count(*) FILTER(WHERE status='pending_verification' AND registration_status='registered')::int AS pending,
 count(*) FILTER(WHERE EXISTS(SELECT FROM farmer_data_issues i WHERE i.farmer_id=filtered.id AND i.status='open'))::int AS needs_review,
 json_build_object('Satima Farmers',count(*) FILTER(WHERE category='Satima Farmers' AND record_kind='registered'),
 'Larger Sagana Farmers',count(*) FILTER(WHERE category='Larger Sagana Farmers' AND record_kind='registered'),
 'Kangema Farmers',count(*) FILTER(WHERE category='Kangema Farmers' AND record_kind='registered'),
 'Others',count(*) FILTER(WHERE category='Others' AND record_kind='registered')) AS categories FROM filtered),
 paged AS (SELECT f.id,f.customer_id,f.full_name,f.primary_phone,f.kra_pin,f.gender,f.county,f.village_area,f.status,f.record_kind,f.registration_status,f.category,f.registration_date::text,${count} AS open_issues FROM filtered f ORDER BY ${order} LIMIT ${limit} OFFSET ${offset})
 SELECT row_to_json(stats) AS stats,coalesce((SELECT json_agg(paged) FROM paged),'[]'::json) AS farmers FROM stats`;
 return {sql,values,page,pageSize,sort,direction};
}
export async function listFarmers(pool,params){const query=directoryQuery(params);const {rows:[data]}=await pool.query(query.sql,query.values);return {...data,pagination:{page:query.page,page_size:query.pageSize,total:data.stats.total,total_pages:Math.ceil(data.stats.total/query.pageSize),sort:query.sort,direction:query.direction}};}

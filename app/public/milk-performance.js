(function(){
 const storageKey='satima-performance-month';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=value=>Number(value).toLocaleString('en-KE',{maximumFractionDigits:2});
 const shown=(value,rate=false)=>value===null||value===undefined?'Not reported':rate?`${(Number(value)*100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})}%`:`${number(value)} L`;
 const selectedKey=data=>data.selected?`${data.selected.year}-${String(data.selected.month).padStart(2,'0')}`:'';
 const metric=(data,key)=>data.metrics.find(item=>item.key===key);
 const total=(data,key)=>{const value=data.totals[key]?.value;if(value===null||value===undefined)return data.records.some(row=>row[key]!==null&&row[key]!==undefined)?'Incomplete':'Not reported';return shown(value,metric(data,key)?.aggregation==='rate');};
 const groups={
  collection:{title:'Historical Milk Collection',description:'Source-reported farmer supply · separate from recorded milk collections.',keys:['farmers_milk_supply_liters'],trend:'farmers_milk_supply_liters'},
  processing:{title:'Historical Milk Processing',description:'Source-reported pasteurization figures · these are not recorded processing-batch output.',keys:['available_for_pasteurization_liters','pstd_inc_cf_reported_total_liters'],trend:'available_for_pasteurization_liters'},
  distribution:{title:'Historical Milk Distribution',description:'Source-reported weekly distribution · raw milk out is separate from Total Milk Out.',keys:['milk_out_stores_liters','milk_out_homes_liters','milk_out_raw_liters','total_milk_out_liters','total_sales_source_liters'],trend:'total_milk_out_liters'},
  returns:{title:'Returns & Inventory',description:'Historical returns are post-distribution and do not alter live batch inventory.',keys:['returns_liters','return_rate_source_fraction','rescued_liters','inhouse_liters','rnd_liters','carry_forward_pasteurized_liters','carry_forward_raw_liters']}
 };
 function selector(host){host.innerHTML='<div class="performance-heading"><div><h2>Milk Performance Overview</h2><p>Historical weekly business reports · separate from the operational date range and transactions.</p></div><label>Historical Reporting Month<select class="performance-month" aria-label="Historical reporting month"></select></label></div><p class="performance-status" role="status">Loading historical performance…</p><div class="performance-results"></div>';return {select:host.querySelector('.performance-month'),status:host.querySelector('.performance-status'),results:host.querySelector('.performance-results')};}
 function warning(data,admin,keys){
  const relevant=admin?data.records.flatMap(row=>(row.issues||[]).filter(issue=>keys.includes(issue.metric)).map(issue=>({week:row.week_number,row:row.source_row,...issue}))):[];
  const count=keys.length?keys.reduce((sum,key)=>sum+Number(data.issue_metrics?.[key]||0),0):data.issue_count;
  if(!count)return '';
  return `<p class="performance-warning-text">${count} source validation note${count===1?'':'s'} recorded for ${keys.length?'these metrics':'this month'}.</p>${admin&&relevant.length?`<details class="performance-issues"><summary>Review notes for these metrics</summary><ul>${relevant.map(issue=>`<li><strong>Week ${issue.week}, workbook row ${issue.row}:</strong> ${esc(issue.note)} Reported ${esc(issue.reported_value??'blank')}; calculated ${esc(issue.calculated_value??'blank')}.</li>`).join('')}</ul></details>`:''}`;
 }
 function table(data,keys){
  const weeks=Math.max(0,...data.records.map(row=>row.week_number)),byWeek=new Map(data.records.map(row=>[row.week_number,row]));
  const rows=keys.map(key=>{const item=metric(data,key),cells=Array.from({length:weeks},(_,index)=>{const value=byWeek.get(index+1)?.[key];return `<td>${value===null||value===undefined?'—':esc(shown(value,item.aggregation==='rate'))}</td>`;}).join('');
   return `<tr><th scope="row">${esc(item.label)}</th>${cells}<td><strong>${esc(total(data,key))}</strong>${item.aggregation==='latest'?'<small>Latest reading</small>':''}</td></tr>`;}).join('');
  return `<p class="performance-scroll-hint">Scroll horizontally for all reported weeks.</p><div class="table-wrap performance-table-wrap" tabindex="0" role="region" aria-label="Weekly historical performance; scroll horizontally for all weeks"><table class="performance-table"><thead><tr><th>Performance Metric</th>${Array.from({length:weeks},(_,i)=>`<th>Week ${i+1}</th>`).join('')}<th>Total / Latest</th></tr></thead><tbody>${rows}</tbody></table></div>`;
 }
 function trend(data,key){
  const values=data.records.map(row=>row[key]===null||row[key]===undefined?null:Number(row[key]));
  if(!values.some(value=>value!==null))return '<p class="muted">No weekly values reported for this metric.</p>';
  const maximum=Math.max(1,...values.filter(value=>value!==null));
  return `<div class="performance-trend" role="img" aria-label="Weekly historical trend for ${esc(metric(data,key).label)}">${values.map((value,index)=>`<div class="performance-trend-item" title="Week ${data.records[index].week_number}: ${value===null?'not reported':esc(shown(value))}"><span class="performance-trend-value">${value===null?'—':esc(shown(value))}</span><span class="performance-trend-track">${value===null?'':`<span style="height:${Math.max(2,value/maximum*100)}%"></span>`}</span><span>Week ${data.records[index].week_number}</span></div>`).join('')}</div>`;
 }
 function reconciliation(data,scope){
  const result=data.reconciliation?.[scope];if(!result)return '';
  const labels={reconciled:'Reconciled',difference_detected:'Difference Detected',incomplete:'Incomplete',not_comparable:'Not Comparable'};
  const destinations=scope==='distribution'&&data.reconciliation.destinations?`<div class="performance-reconciliation-destinations">${[['stores','Stores'],['homes','Homes / Customers']].map(([key,name])=>{const item=data.reconciliation.destinations[key];return `<p><strong>${name}:</strong> ${esc(labels[item.status]||item.status)} · source ${esc(shown(item.reported_liters))}; recorded ${item.recorded_liters===null?'not recorded':esc(shown(item.recorded_liters))}. ${esc(item.reason)}</p>`;}).join('')}<p><strong>Raw milk out:</strong> ${esc(data.reconciliation.raw.reason)}</p></div>`:'';
  return `<div class="performance-reconciliation"><h3>Historical / Recorded Reconciliation</h3><p class="muted">Historical business actuals are compared with individual recorded operations only when the reporting dates and metric definitions align.</p><div class="performance-reconciliation-grid"><div><span>Source-reported</span><strong>${esc(shown(result.reported_liters))}</strong></div><div><span>Recorded operations</span><strong>${result.recorded_liters===null?'Not recorded':esc(shown(result.recorded_liters))}</strong></div><div><span>Difference</span><strong>${result.difference_liters===null?'Not calculated':esc(shown(result.difference_liters))}</strong></div></div><p><strong>${esc(labels[result.status]||result.status)}</strong> · ${esc(result.reason)}</p>${destinations}${result.source_issue_count?`<p class="performance-warning-text">${esc(result.source_issue_count)} source validation note(s) apply to this metric.</p>`:''}</div>`;
 }
 function section(data,scope,admin){
  const group=groups[scope];return `<div class="performance-section-head"><div><h2>${group.title}</h2><p class="muted">${group.description}</p></div><span class="performance-period">${esc(data.selected.label)}</span></div><div class="performance-summary">${group.keys.map(key=>{const item=metric(data,key);return `<div class="performance-summary-card"><span>${esc(item.label)}</span><strong>${esc(total(data,key))}</strong><small>${item.aggregation==='latest'?'Latest weekly reading':item.aggregation==='rate'?'Calculated monthly rate':'Monthly total'}</small></div>`;}).join('')}</div>${scope==='collection'&&data.previous_month?`<p class="muted">Previous reported month (${esc(data.previous_month.label)}): ${data.previous_month.farmers_milk_supply_liters===null?'Incomplete':esc(shown(data.previous_month.farmers_milk_supply_liters))}</p>`:''}${group.trend?`<div class="performance-trend-panel"><h3>Historical ${scope==='collection'?'Collection':scope==='processing'?'Processing':'Distribution'} Trend</h3>${trend(data,group.trend)}</div>`:''}<details class="performance-weeks" ${scope==='returns'?'':'open'}><summary>Weekly breakdown</summary>${table(data,group.keys)}</details>${scope==='returns'?'':reconciliation(data,scope)}<p class="muted performance-note">Weekly periods are source labels without verified calendar dates. A dash means the source cell was blank; incomplete monthly totals are not treated as zero.${scope==='returns'?' Return percentage is calculated from monthly returns ÷ Total Milk Out. In-house and carry-forward show the latest recorded reading.':''}</p>${warning(data,admin,group.keys)}`;
 }
 function mountModule(host,api,scope,admin,returnsHost){
  if(!host||!groups[scope])return;
  const ui=selector(host);let request=0;
  async function load(month){const current=++request;ui.status.textContent='Loading historical performance…';try{
   const data=await api('/milk-performance'+(month?'?month='+encodeURIComponent(month):''));if(current!==request||!host.isConnected)return;
   ui.select.innerHTML=data.months.map(item=>`<option value="${item.year}-${String(item.month).padStart(2,'0')}">${esc(item.label)}</option>`).join('');
   if(!data.selected){ui.status.textContent='No historical performance has been imported yet.';ui.results.innerHTML='';ui.select.disabled=true;if(returnsHost)returnsHost.innerHTML='<h2>Returns & Inventory</h2><p class="muted">No historical performance has been imported yet.</p>';return;}
   const active=selectedKey(data);ui.select.value=active;sessionStorage.setItem(storageKey,active);ui.status.textContent='';ui.results.innerHTML=section(data,scope,admin);
   if(returnsHost)returnsHost.innerHTML=section(data,'returns',admin);
  }catch(error){if(current!==request||!host.isConnected)return;ui.status.textContent=error.message||'Historical performance could not be loaded.';ui.results.innerHTML='';if(returnsHost)returnsHost.innerHTML='<h2>Returns & Inventory</h2><p class="error">Historical figures could not be loaded.</p>';}}
  ui.select.onchange=()=>load(ui.select.value);load(sessionStorage.getItem(storageKey)).catch(()=>{});
 }
 function mountHome(host,api,admin){
  if(!host)return;const ui=selector(host),base=location.pathname.startsWith('/operations')?'/operations':'';let request=0;
  async function load(month){const current=++request;ui.status.textContent='Loading historical performance…';try{
   const data=await api('/milk-performance'+(month?'?month='+encodeURIComponent(month):''));if(current!==request||!host.isConnected)return;
   ui.select.innerHTML=data.months.map(item=>`<option value="${item.year}-${String(item.month).padStart(2,'0')}">${esc(item.label)}</option>`).join('');
   if(!data.selected){ui.status.textContent='No historical performance has been imported yet.';ui.results.innerHTML='';ui.select.disabled=true;return;}
   ui.select.value=selectedKey(data);sessionStorage.setItem(storageKey,ui.select.value);ui.status.textContent='';
   ui.results.innerHTML=`<div class="performance-home-grid">${[['Milk Collection','farmers_milk_supply_liters','milk-collection'],['Milk Processing','available_for_pasteurization_liters','milk-processing'],['Milk Distribution','total_milk_out_liters','milk-distribution']].map(([label,key,path])=>`<a class="performance-home-link" href="${base}/${path}"><span>${label}</span><strong>${esc(total(data,key))}</strong><small>${esc(data.selected.label)} · source-reported</small><b>View weekly figures →</b></a>`).join('')}</div><p class="muted performance-note">Historical workbook totals are separate from live operational records and the homepage reporting-period filter.</p>${warning(data,admin,[])}`;
  }catch(error){if(current!==request||!host.isConnected)return;ui.status.textContent=error.message||'Historical performance could not be loaded.';ui.results.innerHTML='';}}
  ui.select.onchange=()=>load(ui.select.value);load(sessionStorage.getItem(storageKey)).catch(()=>{});
 }
 window.milkPerformance={mount:mountHome,mountHome,mountModule};
})();

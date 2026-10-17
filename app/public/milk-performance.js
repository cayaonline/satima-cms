(function(){
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=value=>Number(value).toLocaleString('en-KE',{maximumFractionDigits:2});
 const shown=(value,rate=false)=>value===null||value===undefined?'—':rate?`${(Number(value)*100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})}%`:`${number(value)} L`;
 function mount(host,api,admin){
  if(!host)return;
  host.innerHTML='<div class="performance-heading"><div><h2>Milk Performance Overview</h2><p>Source-reported weekly business performance · separate from operational transactions.</p></div><label>Reporting Month<select id="performance-month" aria-label="Reporting month"></select></label></div><p id="performance-status" role="status">Loading historical performance…</p><div id="performance-results"></div>';
  const select=host.querySelector('#performance-month'),status=host.querySelector('#performance-status'),results=host.querySelector('#performance-results');
  const storageKey='satima-performance-month';let request=0;
  async function load(month){const current=++request;status.textContent='Loading historical performance…';try{
    const data=await api('/milk-performance'+(month?'?month='+encodeURIComponent(month):''));if(current!==request)return;
    select.innerHTML=data.months.map(m=>`<option value="${m.year}-${String(m.month).padStart(2,'0')}">${esc(m.label)}</option>`).join('');
    if(!data.selected){status.textContent='No historical performance has been imported yet.';results.innerHTML='';select.disabled=true;return;}
    const active=`${data.selected.year}-${String(data.selected.month).padStart(2,'0')}`;select.value=active;sessionStorage.setItem(storageKey,active);status.textContent='';
    const weeks=Math.max(...data.records.map(r=>r.week_number));const byWeek=new Map(data.records.map(r=>[r.week_number,r]));
    let lastGroup='';const body=data.metrics.map(metric=>{
     const head=metric.group===lastGroup?'':`<tr class="performance-group"><th scope="rowgroup" colspan="${weeks+3}">${esc(metric.group)}</th></tr>`;lastGroup=metric.group;
     const cells=Array.from({length:weeks},(_,i)=>{const week=byWeek.get(i+1),value=week?.[metric.key]??null;return `<td>${shown(value,metric.aggregation==='rate')}</td>`;}).join('');
     const total=data.totals[metric.key],summary=total.value===null?'Incomplete':shown(total.value,metric.aggregation==='rate');
     return head+`<tr><td class="performance-month-name">${esc(data.selected.label)}</td><th scope="row">${esc(metric.label)}</th>${cells}<td><strong>${summary}</strong>${metric.aggregation==='latest'?'<small>Latest reading</small>':''}</td></tr>`;
    }).join('');
    results.innerHTML=`<p class="performance-scroll-hint">Scroll horizontally to see weekly figures and totals.</p><div class="table-wrap performance-table-wrap" tabindex="0" aria-label="Weekly milk performance table; scroll horizontally to view all weeks"><table class="performance-table"><thead><tr><th>Month</th><th>Performance Metric</th>${Array.from({length:weeks},(_,i)=>`<th>Week ${i+1}</th>`).join('')}<th>Total / Latest</th></tr></thead><tbody>${body}</tbody></table></div><p class="muted performance-note">A dash means the source cell was blank. Totals require complete weekly figures; inventory and carry-forward rows show the latest recorded reading. Raw milk out is separate from total milk out. Returns are post-distribution.</p>${data.issue_count?`<p class="performance-warning-text">${data.issue_count} source validation note${data.issue_count===1?'':'s'} recorded.</p>`:''}${admin&&data.issue_count?`<details class="performance-issues"><summary>Review source validation notes</summary><ul>${data.records.flatMap(r=>(r.issues||[]).map(issue=>`<li><strong>Week ${r.week_number}, workbook row ${r.source_row}:</strong> ${esc(issue.note)} Reported ${esc(issue.reported_value??'blank')}; calculated ${esc(issue.calculated_value??'blank')}.</li>`)).join('')}</ul></details>`:''}`;
  }catch(error){if(current!==request)return;status.textContent=error.message||'Historical performance could not be loaded.';results.innerHTML='';}}
  select.onchange=()=>load(select.value);
  const saved=sessionStorage.getItem(storageKey);load(saved).catch(()=>{});
 }
 window.milkPerformance={mount};
})();

(()=>{
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const item=(label,value)=>`<div class="kv"><dt>${esc(label)}</dt><dd>${esc(value||'—')}</dd></div>`;
 async function mount(api,sourceId,host){
  host.innerHTML='<p class="muted">Loading supplier source…</p>';
  try{
   const {source,candidates,history}=await api('/flagged-records/'+sourceId);
   host.innerHTML=`<div class="card"><h2>Source Supplier Row ${esc(source.row_number)}</h2><dl>${item('Supplier Name',source.source_name)}${item('Category',source.source_category)}${item('Phone',source.source_phone)}${item('Source',`${source.document_name} · ${source.sheet_name} · row ${source.row_number}`)}${item('Review Reason',source.review_reason)}</dl></div>
    <form id="supplier-review-form" class="card operation-form"><h2>Administrator Decision</h2><p class="muted">Compare the source with existing registration evidence before confirming identity. Only checked source fields will replace CMS values.</p>
    <fieldset><legend>Possible CMS Matches</legend>${candidates.length?candidates.map(c=>`<label class="flagged-choice"><input type="radio" name="farmer_id" value="${esc(c.id)}" data-revision="${esc(c.revision)}"><span><strong>${esc(c.customer_id||'Provisional')} · ${esc(c.full_name)}</strong><br>${esc(c.primary_phone||'No phone')} · ${esc(c.category||'Awaiting categorisation')} · ${esc(c.registration_status)}</span></label>`).join(''):'<p class="muted">No candidate records are available.</p>'}</fieldset>
    <fieldset><legend>Approved source updates for a confirmed match</legend><label><input type="checkbox" name="approved_fields" value="full_name"> Name</label><label><input type="checkbox" name="approved_fields" value="primary_phone" ${source.source_phone?'':'disabled'}> Phone</label><label><input type="checkbox" name="approved_fields" value="category" ${source.source_category?'':'disabled'}> Category</label></fieldset>
    <label>Review Note<textarea name="note" rows="3" maxlength="1000" placeholder="Explain the evidence behind this decision"></textarea></label>
    <p id="supplier-review-error" class="error" role="alert"></p><div class="heading-actions"><button class="primary" type="button" data-decision="match" ${candidates.length?'':'disabled'}>Match Existing Farmer</button><button class="secondary" type="button" data-decision="create">Create Provisional Farmer</button><button class="secondary" type="button" data-decision="defer">Keep Flagged</button></div></form>
    <section class="card"><h2>Review History</h2>${history.length?history.map(row=>`<p>${esc(row.decision)} · ${esc(row.actor)} · ${esc(window.satimaDates.formatDateTime(row.created_at))}${row.note?`<br>${esc(row.note)}`:''}</p>`).join(''):'<p class="muted">No decisions recorded yet.</p>'}</section>`;
   const form=host.querySelector('#supplier-review-form'),error=host.querySelector('#supplier-review-error');
   form.onclick=async event=>{const button=event.target.closest('[data-decision]');if(!button)return;error.textContent='';const decision=button.dataset.decision,selected=form.querySelector('[name="farmer_id"]:checked')?.value||null,note=form.elements.note.value.trim();
    if(decision==='match'&&!selected){error.textContent='Select the farmer you have confirmed against the source.';return;}
    if(decision==='create'&&!window.confirm('Create a provisional, unregistered farmer from this source? Confirm that no matching CMS profile exists.'))return;
    if(decision==='match'&&!window.confirm('Confirm the selected farmer and approved source updates?'))return;
    const payload={decision,farmer_id:selected,expected_revision:form.querySelector('[name="farmer_id"]:checked')?.dataset.revision||null,approved_fields:[...form.querySelectorAll('[name="approved_fields"]:checked')].map(x=>x.value),note};
    form.querySelectorAll('button').forEach(x=>x.disabled=true);
    try{await api('/flagged-records/'+sourceId,{method:'POST',body:JSON.stringify(payload)});if(decision==='defer')return mount(api,sourceId,host);location.assign('/farmers/flagged-records');}catch(cause){error.textContent=cause.message;form.querySelectorAll('button').forEach(x=>x.disabled=false);}
   };
  }catch(cause){host.innerHTML=`<div class="empty error">${esc(cause.message)}</div>`;}
 }
 window.flaggedReview={mount};
})();

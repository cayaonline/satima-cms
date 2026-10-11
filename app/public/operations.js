const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const categoryRoutes={'Satima Farmers':'/operations/category/satima','Larger Sagana Farmers':'/operations/category/larger-sagana','Kangema Farmers':'/operations/category/kangema','Others':'/operations/category/others'};
const routeCategory=Object.entries(categoryRoutes).find(([,path])=>path===location.pathname)?.[0]||null;
const stakeholderPages={
 '/operations/customers':{name:'Customers',label:'CUSTOMER MANAGEMENT',title:'Customer Directory',description:'Manage and organize Morning Dew customer records.',empty:'No customers registered yet',emptyDescription:'Customer records will appear here once they are added to the system.'},
 '/operations/distributors':{name:'Distributors',label:'DISTRIBUTION NETWORK',title:'Distributor Directory',description:'Manage and organize Morning Dew distribution partners.',empty:'No distributors registered yet',emptyDescription:'Distributor records will appear here once they are added to the system.'}
};
const stakeholderRoute=stakeholderPages[location.pathname];
let page=1,requestNumber=0,debounce;
let sensitiveRegistration=false;

if(routeCategory){
 document.title=routeCategory+' · Morning Dew Operations Portal';
 $('#back-directory').hidden=false;$('#supplier-section').hidden=true;
 $('#page-title').textContent=routeCategory;$('#breadcrumb').textContent=routeCategory;
 $('#page-subtitle').textContent='Farmers in this supplier category.';
 $('#category-total').hidden=false;$('#category').value=routeCategory;$('#category').closest('label').hidden=true;
}
if(stakeholderRoute){
 document.title=stakeholderRoute.title+' · Morning Dew Operations Portal';
 $('#farmer-content').hidden=true;$('#stakeholder-content').hidden=false;
 $('#breadcrumb').textContent=stakeholderRoute.name;
 for(const [id,value] of [['stakeholder-label',stakeholderRoute.label],['stakeholder-title',stakeholderRoute.title],['stakeholder-description',stakeholderRoute.description],['stakeholder-empty-title',stakeholderRoute.empty],['stakeholder-empty-description',stakeholderRoute.emptyDescription]])$('#'+id).textContent=value;
 document.querySelectorAll('[data-nav]').forEach(link=>{const active=link.dataset.nav===stakeholderRoute.name.toLowerCase();link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
}

async function api(path,options={}){
 const response=await fetch('/api/operations'+path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
 const data=await response.json();
 if(!response.ok){if(response.status===401&&path!=='/login'&&location.pathname!=='/operations/login')location.replace('/operations/login');throw Object.assign(new Error(data.error||'Request failed.'),{status:response.status});}
 return data;
}
function showLogin(){if(location.pathname!=='/operations/login'){location.replace('/operations/login');return;}$('#login').hidden=false;$('#workspace').hidden=true;}
async function start(){try{const session=await api('/session');sensitiveRegistration=session.sensitive_registration===true;if(location.pathname==='/operations/login'){location.replace('/operations');return;}$('#login').hidden=true;$('#workspace').hidden=false;if(!stakeholderRoute)await load();}catch{showLogin();}}
setupLogin(async credentials=>{await api('/login',{method:'POST',body:JSON.stringify(credentials)});location.assign('/operations');});
$('#logout').addEventListener('click',async()=>{try{await api('/logout',{method:'POST',body:'{}'});location.replace('/operations/login');}catch(error){$('#toast').textContent=error.message;$('#toast').hidden=false;}});

function genderLabel(value){return {male:'Male',female:'Female',not_verified:'Not verified'}[value]||'Not verified';}
function registrationLabel(value){return value==='registered'?'Registered':'Not registered';}
function date(value){return value?new Date(value+'T12:00:00+03:00').toLocaleDateString('en-GB',{timeZone:'Africa/Nairobi'}):'Not recorded';}
function field(label,value){return `<div class="kv"><dt>${esc(label)}</dt><dd>${esc(value||'Not recorded')}</dd></div>`;}
function sensitiveField(label,value){return `<div class="kv"><dt>${esc(label)}</dt><dd>${esc(value===null||value===undefined||value===''?'Not Recorded':value)}</dd></div>`;}
function recordedBoolean(value){return value===true?'Yes':value===false?'No':'Not Recorded';}
function evidenceCards(items,render){return items.length?items.map((item,index)=>`<div class="card"><p class="muted">Record ${index+1}</p>${render(item)}</div>`).join(''):'<p class="muted">Not Recorded</p>';}
function registrationDetails(record){
 const consents=evidenceCards(record.consents,consent=>`<dl>${sensitiveField('Signed name',consent.signed_name)}${sensitiveField('Signature method',consent.signature_method)}${sensitiveField('Signature image','Not Recorded')}${sensitiveField('Consent date',consent.consent_date)}${sensitiveField('Consent given',recordedBoolean(consent.consent_given))}${sensitiveField('Information accuracy',recordedBoolean(consent.information_accuracy_confirmed))}${sensitiveField('Data processing',recordedBoolean(consent.data_processing_consent))}${sensitiveField('Communications',recordedBoolean(consent.communications_consent))}${sensitiveField('Withdrawal date',consent.withdrawn_at)}</dl>`);
 const verifications=evidenceCards(record.verifications,verification=>`<dl>${sensitiveField('Verified by',verification.verified_by)}${sensitiveField('Verified at',verification.verified_at)}${sensitiveField('Officer signature image','Not Recorded')}${[['National ID verified','national_id_verified'],['KRA PIN verified','kra_pin_verified'],['Primary phone verified','primary_phone_verified'],['M-Pesa number verified','mpesa_number_verified'],['M-Pesa name confirmed','mpesa_registered_name_confirmed'],['Registration form complete','registration_form_complete'],['Consent obtained','consent_obtained']].map(([label,key])=>sensitiveField(label,recordedBoolean(verification[key]))).join('')}${sensitiveField('Notes',verification.notes)}</dl>`);
 const sources=evidenceCards(record.sources,source=>`<p>${esc(source.document_name)} · Pages ${esc(source.first_page)}–${esc(source.last_page)}</p><pre class="registration-transcript">${esc(JSON.stringify(source.raw_transcription,null,2))}</pre>`);
 const directorySources=record.directory_sources.length?`<ul class="source-list">${record.directory_sources.map(source=>`<li>${esc(source.document_name)} · Page ${esc(source.page_number)}</li>`).join('')}</ul>`:'<p class="muted">Not Recorded</p>';
 const contactHistory=record.contacts.length>1||record.payments.length>1?`<details class="evidence"><summary>Additional contact and payment records</summary><h4>Contacts</h4>${evidenceCards(record.contacts,contact=>`<dl>${sensitiveField('Name',contact.full_name)}${sensitiveField('Phone',contact.phone_number)}${sensitiveField('Relationship',contact.relationship)}</dl>`)}<h4>M-Pesa profiles</h4>${evidenceCards(record.payments,item=>`<dl>${sensitiveField('Registered name',item.mpesa_registered_name)}${sensitiveField('Phone',item.mpesa_phone_number)}${sensitiveField('Payment verification',item.verified?'Verified':'Not confirmed')}${sensitiveField('Active',recordedBoolean(item.is_active))}</dl>`)}</details>`:'';
 return `<section class="registration-details" aria-labelledby="registration-details-title"><h3 id="registration-details-title">Registration &amp; Verification Details</h3>${contactHistory}<details class="evidence"><summary>Consent &amp; Signatures</summary><h4>Consent records</h4>${consents}<h4>Verification records</h4>${verifications}</details><details class="evidence"><summary>Original Registration Records</summary><h4>Raw registration form transcripts</h4>${sources}<h4>Supporting document references</h4>${directorySources}</details></section>`;
}
function profileSummary(farmer,registration){
 if(!registration)return `<div class="detail-grid"><div class="card"><h3>Farmer information</h3><dl>${field('Business',farmer.registered_business_name)}${field('Registration date',date(farmer.registration_date))}${field('Primary phone',farmer.primary_phone)}${field('Gender',genderLabel(farmer.gender))}</dl></div><div class="card"><h3>Location</h3><dl>${field('Village / area',farmer.village_area)}${field('Sub-location',farmer.sub_location)}${field('Location',farmer.location)}${field('Sub-county',farmer.sub_county)}${field('County',farmer.county)}</dl></div></div>`;
 const contact=registration.contacts.find(item=>item.is_primary_alternative)||registration.contacts[0];
 const payment=registration.payments.find(item=>item.is_active)||registration.payments[0];
 return `<div class="detail-grid"><div class="card"><h3>Farmer information</h3><dl>${field('Business',farmer.registered_business_name)}${sensitiveField('National ID',registration.national_id)}${field('Primary phone',farmer.primary_phone)}${field('Gender',genderLabel(farmer.gender))}${sensitiveField('Physical address',registration.physical_address)}${field('Village / area',farmer.village_area)}${field('Sub-location',farmer.sub_location)}${field('Location',farmer.location)}${field('Sub-county',farmer.sub_county)}${field('County',farmer.county)}${sensitiveField('KRA PIN',registration.kra_pin)}${sensitiveField('Registered by',registration.registered_by)}${field('Registration date',date(farmer.registration_date))}</dl></div><div><div class="card"><h3>Next of kin</h3>${contact?`<dl>${sensitiveField('Name',contact.full_name)}${sensitiveField('Phone',contact.phone_number)}${sensitiveField('Relationship',contact.relationship)}</dl>`:'<p class="muted">Not Recorded</p>'}</div><div class="card"><h3>M-Pesa payment profile</h3>${payment?`<dl>${sensitiveField('Registered name',payment.mpesa_registered_name)}${sensitiveField('Phone',payment.mpesa_phone_number)}${sensitiveField('Payment verification',payment.verified?'Verified':'Not confirmed')}</dl>`:'<p class="muted">Not Recorded</p>'}<p class="muted">Paper verification history is recorded separately below.</p></div></div></div>`;
}
function photoCard(farmer){return `<section class="card profile-photo"><h3>Farmer Photograph</h3><div class="photo-row"><img class="passport-photo" src="${farmer.has_photograph?`/api/operations/farmers/${esc(farmer.id)}/photo`:'/portrait-placeholder.svg'}" alt="${farmer.has_photograph?`Photograph of ${esc(farmer.full_name)}`:'No photograph uploaded'}"><p class="muted">${farmer.has_photograph?'Photograph on file.':'No photograph uploaded yet.'}</p></div></section>`;}

async function load(){
 const ticket=++requestNumber,[sort,direction]=$('#sort').value.split(':');
 try{
  const data=await api('/farmers?'+new URLSearchParams({q:$('#search').value,category:routeCategory||$('#category').value,registration:$('#registration').value,gender:$('#gender').value,sort,direction,page}));
  if(ticket!==requestNumber)return;
  if(page>1&&page>data.pagination.total_pages){page=Math.max(1,data.pagination.total_pages);return load();}
  if(routeCategory)$('#category-total').textContent=data.stats.total+' '+(data.stats.total===1?'farmer':'farmers')+' in '+routeCategory+'.';
  $('#stats').innerHTML=[['Total farmers',data.stats.total],['Registered',data.stats.registered],['Not registered',data.stats.not_registered]].map(([label,count])=>`<div class="stat"><span class="stat-top">${esc(label)}</span><strong>${esc(count)}</strong></div>`).join('');
  if(!routeCategory)$('#category-summary').innerHTML=Object.entries(categoryRoutes).map(([name,path])=>`<a class="supplier-category" href="${path}" target="_blank" rel="noopener noreferrer" aria-label="View ${esc(name)} farmers in a new tab"><span class="category-name">${esc(name)}</span><span class="category-arrow" aria-hidden="true">↗</span><strong>${esc(data.stats.categories[name]||0)}</strong></a>`).join('');
  const rows=data.farmers;
  $('#directory').innerHTML=rows.length?`<div class="table-wrap" tabindex="0" role="region" aria-label="Farmer directory table; scroll horizontally to view all columns"><table><thead><tr><th>View</th><th>Farmer ID</th><th>Supplier Category</th><th>Farmer Name</th><th>Registration</th><th>Location</th><th>Phone</th><th>Gender</th></tr></thead><tbody>${rows.map(farmer=>`<tr><td><button class="link-button" data-view="${esc(farmer.id)}" aria-label="View ${esc(farmer.full_name)}">View →</button></td><td class="farmer-id">${esc(farmer.customer_id||'—')}</td><td>${esc(farmer.category||'Not assigned')}</td><td><div class="farmer-cell"><button data-view="${esc(farmer.id)}">${esc(farmer.full_name)}</button></div></td><td><span class="badge">${esc(registrationLabel(farmer.registration_status))}</span></td><td>${esc(farmer.village_area||farmer.location||'Not recorded')}<br><small class="muted">${esc(farmer.county||'')}</small></td><td>${esc(farmer.primary_phone||'Not recorded')}</td><td>${esc(genderLabel(farmer.gender))}</td></tr>`).join('')}</tbody></table></div><div class="table-foot">${rows.length} shown${data.pagination.total_pages>1?` · Page ${page} of ${data.pagination.total_pages}<span class="page-actions"><button class="link-button" data-page="${page-1}" ${page===1?'disabled':''}>Previous</button><button class="link-button" data-page="${page+1}" ${page>=data.pagination.total_pages?'disabled':''}>Next</button></span>`:''}</div>`:'<div class="empty"><h3>No farmers found</h3><p>Try another search or filter.</p></div>';
 }catch(error){$('#directory').innerHTML=`<div class="empty error">${esc(error.message)}</div>`;}
}

$('#directory').addEventListener('click',async event=>{
 const view=event.target.closest('[data-view]');
 if(view){try{const id=encodeURIComponent(view.dataset.view);const farmer=await api('/farmers/'+id);const registration=sensitiveRegistration?await api('/farmers/'+id+'/registration'):null;renderDetail(farmer,registration);$('#detail-dialog').showModal();}catch(error){$('#toast').textContent=error.message;$('#toast').hidden=false;}return;}
 const next=event.target.closest('[data-page]');if(next&&!next.disabled){page=Number(next.dataset.page);load();}
});
function renderDetail(farmer,registration){
 const references=[...farmer.registration_sources.map(source=>`${source.document_name} · pages ${source.first_page}–${source.last_page}`),...farmer.directory_sources.map(source=>`${source.document_name} · page ${source.page_number}`)];
 $('#detail').innerHTML=`<div class="dialog-head"><div class="detail-title"><span class="eyebrow">${esc(farmer.customer_id||'Farmer record')}</span><h2>${esc(farmer.full_name)}</h2><small>${esc(farmer.category||'Not assigned')} · ${esc(registrationLabel(farmer.registration_status))}${farmer.registration_status==='registered'?` · Registered ${date(farmer.registration_date)}`:''} · Read-only</small></div><button class="icon-button" id="close-detail" aria-label="Close farmer">×</button></div><div class="dialog-body">${photoCard(farmer)}${profileSummary(farmer,registration)}<div class="card"><h3>Paper-form evidence</h3>${references.length?`<ul class="source-list">${references.map(reference=>`<li>${esc(reference)}</li>`).join('')}</ul>`:'<p class="muted">No source reference recorded.</p>'}</div>${registration?registrationDetails(registration):''}</div>`;
 $('#close-detail').addEventListener('click',()=>$('#detail-dialog').close());
}
$('#detail-dialog').addEventListener('click',event=>{if(event.target===$('#detail-dialog'))$('#detail-dialog').close();});
$('#search').addEventListener('input',()=>{clearTimeout(debounce);page=1;debounce=setTimeout(load,200);});
for(const id of ['category','registration','gender','sort'])$('#'+id).addEventListener('change',()=>{page=1;load();});
$('#clear-filters').addEventListener('click',()=>{for(const [id,value] of [['category',routeCategory||''],['registration',''],['gender',''],['sort','customer_id:asc'],['search','']])$('#'+id).value=value;page=1;load();});
document.addEventListener('visibilitychange',()=>{if(!stakeholderRoute&&!document.hidden&&!$('#workspace').hidden)load();});
document.addEventListener('pointerdown',event=>{const filters=$('#directory-filters');if(filters.open&&!filters.contains(event.target))filters.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#directory-filters').open){$('#directory-filters').open=false;$('#directory-filters summary').focus();}});
start();

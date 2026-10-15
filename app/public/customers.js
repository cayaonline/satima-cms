window.initCustomerDirectory=function(api){
 const host=document.querySelector('#stakeholder-content .stakeholder-directory');
 if(host.dataset.initialized){window.customerDirectory?.load();return;}
 host.dataset.initialized='true';
 const content=document.querySelector('#stakeholder-content');
 const dialog=document.querySelector('#detail-dialog');
 const detail=document.querySelector('#detail');
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const display=value=>value==null||value===''?'Not recorded':value;
 const categories={current:'Current Customers',lapsed:'Lapsed Customers (Expected to Resume Soon)','geographically-isolated':'Geographically Isolated',dormant:'Dormant / Non-Responsive',retired:'Retired'};
 const base=location.pathname.startsWith('/operations/')?'/operations/customers':'/customers';
 const linkedCustomer=new URLSearchParams(location.search).get('customer');
 const slug=location.pathname.split('/category/')[1];
 const routeCategory=slug?categories[slug]:(location.pathname.endsWith('/awaiting-categorisation')?'unassigned':null);
 let page=1,sort='customer_id',direction='asc',pending=0,timer;
 const columns=[['','View'],['customer_id','Customer ID'],['category','Customer Category'],['full_name','Customer Name'],['physical_address','Address'],['phone_number','Phone Number'],['gender','Gender']];
 const field=(label,value)=>`<div class="kv"><dt>${esc(label)}</dt><dd>${esc(display(value))}</dd></div>`;
 if(routeCategory){const title=routeCategory==='unassigned'?'Awaiting Categorisation':routeCategory;content.querySelector('#stakeholder-title').textContent=title;content.querySelector('#stakeholder-description').textContent='Customers in this directory.';content.insertAdjacentHTML('afterbegin',`<a class="back-directory" href="${base}">← Back to Customer Directory</a>`);document.querySelector('#breadcrumb').textContent=title;}
 content.querySelector('.heading').insertAdjacentHTML('afterend',`<div class="stats customer-stats"><div class="stat"><span class="stat-top">Total customers</span><strong id="customer-total">—</strong></div></div>${routeCategory?'':`<section class="supplier-categories customer-categories" aria-labelledby="customer-categories-title"><h2 id="customer-categories-title">Customer Categories</h2><p class="category-guidance">Select a category to view customers →</p><div id="customer-category-summary" class="category-summary" aria-live="polite"></div><p id="customer-category-incomplete" class="category-incomplete"></p></section>`}`);
 host.removeAttribute('aria-labelledby');
 host.innerHTML=`<div class="toolbar"><label class="search"><span>⌕</span><input id="customer-search" aria-label="Search customers" placeholder="Search any column" autocomplete="off"></label><div class="customer-controls"><label class="customer-sort-label">Category<select id="customer-category"><option value="">All categories</option>${Object.values(categories).map(label=>`<option value="${esc(label)}">${esc(label)}</option>`).join('')}<option value="unassigned">Awaiting Categorisation</option></select></label><label class="customer-sort-label">Sort by<select id="customer-sort"><option value="customer_id:asc">Customer ID</option><option value="full_name:asc">Customer Name</option><option value="category:asc">Customer Category</option><option value="physical_address:asc">Address</option><option value="phone_number:asc">Phone Number</option><option value="gender:asc">Gender</option></select></label></div></div><div id="customer-directory" aria-live="polite"></div>`;
 const table=host.querySelector('#customer-directory'),search=host.querySelector('#customer-search'),selector=host.querySelector('#customer-sort'),category=host.querySelector('#customer-category');
 if(routeCategory){category.value=routeCategory;category.closest('label').hidden=true;}
 async function load(){
  const ticket=++pending;
  try{
   const data=await api('/customers?'+new URLSearchParams({q:search.value,category:routeCategory||category.value,sort,direction,page}));
   if(ticket!==pending)return;
   if(page>data.pagination.total_pages){page=data.pagination.total_pages;return load();}
   content.querySelector('#customer-total').textContent=routeCategory?data.pagination.total:data.total;
   if(!routeCategory){
    content.querySelector('#customer-category-summary').innerHTML=Object.entries(categories).map(([key,label])=>`<a class="supplier-category" href="${base}/category/${key}" aria-label="View ${esc(label)} customers"><span class="category-name">${esc(label)}</span><span class="category-arrow" aria-hidden="true">↗</span><strong>${esc(data.stats.categories[label]||0)}</strong><span class="card-action">View Customers →</span></a>`).join('');
    content.querySelector('#customer-category-incomplete').innerHTML=data.stats.uncategorized?`<a href="${base}/awaiting-categorisation" aria-label="View ${esc(data.stats.uncategorized)} customers awaiting categorisation"><span class="category-incomplete-copy"><strong>Awaiting Categorisation</strong><span>${esc(data.stats.uncategorized)} customer ${data.stats.uncategorized===1?'record needs':'records need'} category confirmation</span><span class="card-action">View Customers →</span></span><span class="category-incomplete-action"><strong>${esc(data.stats.uncategorized)}</strong></span></a>`:'';
   }
   const head=columns.map(([key,label])=>`<th${key?` aria-sort="${sort===key?(direction==='asc'?'ascending':'descending'):'none'}"`:''}>${key?`<button type="button" data-sort="${key}" aria-label="Sort by ${label}">${label}${sort===key?` <span aria-hidden="true">${direction==='asc'?'↑':'↓'}</span>`:''}</button>`:label}</th>`).join('');
   table.innerHTML=data.customers.length?`<div class="table-wrap" tabindex="0" role="region" aria-label="Customer directory table; scroll to view all columns and rows"><table><thead><tr>${head}</tr></thead><tbody>${data.customers.map(c=>`<tr><td><button class="link-button" data-customer="${esc(c.id)}">View →</button></td><td class="farmer-id">${esc(c.customer_id)}</td><td>${esc(c.category||'Awaiting Categorisation')}</td><td><div class="farmer-cell"><button data-customer="${esc(c.id)}">${esc(c.full_name)}</button></div></td><td>${esc(display(c.physical_address))}</td><td>${esc(display(c.phone_number))}</td><td>${esc(c.gender?c.gender[0].toUpperCase()+c.gender.slice(1):'Not specified')}</td></tr>`).join('')}</tbody></table></div><div class="table-foot">${esc(data.pagination.total)} ${data.pagination.total===1?'customer':'customers'}${data.pagination.total_pages>1?` · Page ${page} of ${data.pagination.total_pages}<span class="page-actions"><button class="link-button" data-page="${page-1}" ${page===1?'disabled':''}>Previous</button><button class="link-button" data-page="${page+1}" ${page>=data.pagination.total_pages?'disabled':''}>Next</button></span>`:''}</div>`:'<div class="empty"><h3>No customers found</h3><p>Try another search.</p></div>';
  }catch(error){if(ticket===pending)table.innerHTML=`<div class="empty error">${esc(error.message)}</div>`;}
 }
 async function open(id){
  try{const c=await api('/customers/'+encodeURIComponent(id));detail.innerHTML=`<div class="dialog-head"><div class="detail-title"><span class="eyebrow">${esc(c.customer_id)}</span><h2>${esc(c.full_name)}</h2><small>${esc(c.category||'Awaiting Categorisation')} · Customer profile · Read-only</small></div><button class="icon-button" type="button" data-close-customer aria-label="Close customer profile">×</button></div><div class="dialog-body"><div class="card"><h3>Customer information</h3><dl>${field('Customer ID',c.customer_id)}${field('Customer Name',c.full_name)}${field('Customer Category',c.category||'Awaiting Categorisation')}${field('Gender',c.gender?c.gender[0].toUpperCase()+c.gender.slice(1):'Not specified')}${field('Phone Number',c.phone_number)}${field('Physical Address / Location',c.physical_address)}</dl></div></div>`;dialog.showModal();window.mountCustomerDistribution(c.id,api,detail.querySelector('.dialog-body'),base.startsWith('/operations'));}
  catch(error){table.innerHTML=`<div class="empty error">${esc(error.message)}</div>`;}
 }
 host.addEventListener('click',event=>{
  const record=event.target.closest('[data-customer]');if(record){open(record.dataset.customer);return;}
  const paging=event.target.closest('[data-page]');if(paging&&!paging.disabled){page=Number(paging.dataset.page);load();return;}
  const ordering=event.target.closest('[data-sort]');if(ordering){const key=ordering.dataset.sort;direction=sort===key&&direction==='asc'?'desc':'asc';sort=key;page=1;selector.value=sort+':asc';load();}
 });
 detail.addEventListener('click',event=>{if(event.target.closest('[data-close-customer]'))dialog.close();});
 search.addEventListener('input',()=>{clearTimeout(timer);page=1;timer=setTimeout(load,200);});
 selector.addEventListener('change',()=>{[sort,direction]=selector.value.split(':');page=1;load();});
 category.addEventListener('change',()=>{page=1;load();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!content.hidden)load();});
 window.customerDirectory={load};
 load();
 if(linkedCustomer&&/^[0-9a-f-]{36}$/i.test(linkedCustomer))open(linkedCustomer);
};

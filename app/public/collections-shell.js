const operations=location.pathname.startsWith('/operations'),home=operations?'/operations':'/';
document.querySelectorAll('[data-nav]').forEach(link=>{
 const page=location.pathname.endsWith('/daily-reports')?'daily-reports':location.pathname.endsWith('/collections')?'collections':'home';
 const active=link.dataset.nav===page;
 link.classList.toggle('active',active);
 if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
});
document.getElementById('logout').addEventListener('click',async()=>{
 const response=await fetch(operations?'/api/operations/logout':'/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 if(response.ok)location.replace(home);else alert('Sign out failed. Please retry.');
});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});

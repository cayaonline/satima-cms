document.querySelectorAll('[data-nav]').forEach(link=>{
 const active=link.dataset.nav===(location.pathname==='/'?'home':'collections');
 link.classList.toggle('active',active);
 if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
});
document.getElementById('logout').addEventListener('click',async()=>{
 const response=await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 if(response.ok)location.replace('/');else alert('Sign out failed. Please retry.');
});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});

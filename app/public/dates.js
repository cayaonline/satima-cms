(()=>{
 const parts=()=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
 const today=()=>{const p=parts();return `${p.year}-${p.month}-${p.day}`;};
 const validIso=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
 const format=value=>{if(!value)return '';const date=String(value);if(validIso(date))return `${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(0,4)}`;return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value));};
 const formatDateTime=value=>value?`${format(value)} ${new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))}`:'';
 const parse=value=>{const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());if(!match)return null;const iso=`${match[3]}-${match[2]}-${match[1]}`;return validIso(iso)?iso:null;};
 function bind(root=document){for(const input of root.querySelectorAll('input[type="date"]')){
  if(input.dataset.satimaDate)return;input.dataset.satimaDate='true';
  const wrap=document.createElement('span');wrap.className='satima-date-field';input.before(wrap);wrap.append(input);
  const display=document.createElement('input');display.type='text';display.inputMode='numeric';display.placeholder='DD/MM/YYYY';display.autocomplete='off';display.className='satima-date-display';display.setAttribute('aria-label',`${input.closest('label')?.firstChild?.textContent?.trim()||'Date'} (DD/MM/YYYY)`);display.value=format(input.value);
  const button=document.createElement('button');button.type='button';button.className='satima-date-picker';button.setAttribute('aria-label','Open date picker');button.textContent='▦';wrap.append(display,button);
  const sync=()=>{display.value=format(input.value);display.setCustomValidity('');};
  input.addEventListener('input',sync);input.addEventListener('change',sync);
  display.addEventListener('input',()=>{const iso=parse(display.value);if(iso){input.value=iso;input.setCustomValidity('');input.dispatchEvent(new Event('change',{bubbles:true}));}else{input.value='';input.setCustomValidity(display.value?'Enter a valid date as DD/MM/YYYY.':'');}});
  display.addEventListener('blur',()=>{if(display.value&&!parse(display.value))display.setCustomValidity('Enter a valid date as DD/MM/YYYY.');});
  const picker=()=>{sync();try{input.showPicker?.();}catch{input.focus();input.click();}};
  display.addEventListener('click',picker);button.addEventListener('click',picker);
  display.addEventListener('focus',()=>{if(input.value)sync();});
  input._satimaRefresh=sync;
 }}
 const shift=(iso,days)=>{const day=new Date(iso+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+days);return day.toISOString().slice(0,10);};
 function preset(kind){const end=today();if(kind==='daily')return {from:end,to:end};if(kind==='weekly'){const day=new Date(end+'T12:00:00Z').getUTCDay();const from=shift(end,-((day+6)%7));return {from,to:shift(from,6)};}if(kind==='monthly')return {from:end.slice(0,7)+'-01',to:shift(end.slice(0,7)+'-01',new Date(Number(end.slice(0,4)),Number(end.slice(5,7)),0).getDate()-1)};return null;}
 function periodMarkup(prefix){return `<section class="reporting-controls card" aria-label="Reporting period"><h2>Reporting Period</h2><div class="reporting-presets" role="group" aria-label="Reporting period shortcuts">${[['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['custom','Custom Range']].map(([value,label])=>`<button type="button" class="secondary" data-period="${value}" aria-pressed="false">${label}</button>`).join('')}</div><div class="reporting-fields"><label>From<input id="${prefix}-from" type="date"></label><label>To<input id="${prefix}-to" type="date"></label><button type="button" class="primary" id="${prefix}-apply">Apply Range</button></div><p id="${prefix}-range" class="muted" aria-live="polite"></p><p id="${prefix}-error" class="error" role="alert"></p></section>`;}
 function attachPeriod(host,prefix,storageKey,onApply,defaultKind='daily'){
  host.innerHTML=periodMarkup(prefix);bind(host);
  let saved;try{saved=JSON.parse(sessionStorage.getItem('satima-business-range')||sessionStorage.getItem(storageKey)||'null');}catch{saved=null;}
  let kind=saved?.kind||defaultKind;const from=host.querySelector('#'+prefix+'-from'),to=host.querySelector('#'+prefix+'-to'),error=host.querySelector('#'+prefix+'-error');
  const initial=saved?.from&&saved?.to?saved:preset(kind)||preset('daily');from.value=initial.from;to.value=initial.to;
  const paint=()=>{host.querySelectorAll('[data-period]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.period===kind)));host.querySelector('#'+prefix+'-range').textContent=`${format(from.value)} – ${format(to.value)}`;window.satimaDates.refresh();};
  const apply=()=>{error.textContent='';if(!validIso(from.value)||!validIso(to.value)||from.value>to.value){error.textContent='Choose a valid From and To date in DD/MM/YYYY order.';return;}const state={kind,from:from.value,to:to.value};sessionStorage.setItem('satima-business-range',JSON.stringify(state));for(const key of ['satima-milk-collection-period','satima-milk-processing-period','satima-milk-distribution-period'])sessionStorage.setItem(key,JSON.stringify(state));sessionStorage.setItem('satima-reporting-period',JSON.stringify({period:'custom',from:state.from,to:state.to}));paint();onApply(state);document.dispatchEvent(new CustomEvent('satima:reporting-range',{detail:state}));};
  host.querySelectorAll('[data-period]').forEach(button=>button.onclick=()=>{kind=button.dataset.period;if(kind!=='custom'){const dates=preset(kind);from.value=dates.from;to.value=dates.to;apply();}else paint();});
  for(const input of [from,to])input.addEventListener('change',()=>{kind='custom';paint();});
  host.querySelector('#'+prefix+'-apply').onclick=apply;paint();
  return {get:()=>({kind,from:from.value,to:to.value}),apply,set:(nextFrom,nextTo)=>{kind='custom';from.value=nextFrom;to.value=nextTo;apply();}};
 }
 const observer=new MutationObserver(records=>{if(records.some(record=>record.addedNodes.length))bind();});
 document.addEventListener('DOMContentLoaded',()=>{bind();observer.observe(document.body,{childList:true,subtree:true});});
 window.satimaDates={today,format,formatDateTime,parse,bind,preset,periodMarkup,attachPeriod,refresh:()=>{for(const input of document.querySelectorAll('input[type="date"]'))input._satimaRefresh?.();}};
})();

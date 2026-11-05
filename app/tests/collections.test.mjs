import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionsAllowed,collectionsRoutes,exportCsv,preparePresentation} from '../collections.mjs';

const records=[{row:2,name:'FICTIONAL ACCOUNT',amount:100,status:'Not Paid',group:'Unpaid',payment:0,balance:100,textAmount:true}];
const fixture=`<style>:root{color:black}</style><nav class="nav">Sections</nav><main><button onclick="window.print()">Print</button></main><script>const records = ${JSON.stringify(records)};document.getElementById('actionBody');function csvCell(){}</script>`;
test('only Admin and Finance can read Collections',async()=>{
 for(const role of [null,'viewer','registration_viewer','invalid']){
  assert.equal(collectionsAllowed(role),false);
  let queries=0;
  await assert.rejects(collectionsRoutes({method:'GET'},{},'/api/collections',new URL('http://localhost/api/collections'),{role,pool:{query(){queries++;}},viewerRole:null}),error=>error.status===(role?403:401));
  assert.equal(queries,0);
 }
 assert(collectionsAllowed('administrator'));assert(collectionsAllowed('finance'));
});
test('source presentation preserves interactions but removes embedded account records',()=>{
 const view=preparePresentation(fixture,records);
 assert.match(view.script,/const records = data.records/);assert.doesNotMatch(view.script,/FICTIONAL ACCOUNT/);
 assert.match(view.script,/root.getElementById/);assert.doesNotMatch(view.html,/onclick|iframe/);
 assert.match(view.css,/:host/);
 assert.throws(()=>preparePresentation(fixture,[{...records[0],amount:99}]),/mismatch/);
 assert.throws(()=>preparePresentation(fixture,[]),/counts differ/);
});
test('server export preserves source values, filters, and neutralizes formula injection',()=>{
 const csv=exportCsv([...records,{...records[0],row:3,name:'=HYPERLINK("example")',group:'Paid'}],new URLSearchParams());
 assert.match(csv,/"'=HYPERLINK/);
 const filtered=exportCsv(records,new URLSearchParams({q:'fictional',filter:'Unpaid'}));assert.match(filtered,/FICTIONAL ACCOUNT/);
 assert.equal(exportCsv(records,new URLSearchParams({filter:'Paid'})).split('\r\n').length,1);
});
test('export authorization is checked before any database read, including Operations sessions',async()=>{
 for(const path of ['/api/collections/export.csv','/api/collections/dashboard.js']){
  await assert.rejects(collectionsRoutes({method:'GET'},{},path,new URL('http://localhost'+path),{role:null,viewerRole:'registration_viewer',pool:{query(){throw new Error('Must not query');}}}),error=>error.status===403);
 }
});

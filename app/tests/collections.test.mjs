import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionsAllowed,collectionsRoutes,exportCsv,preparePresentation} from '../collections.mjs';

const records=[{row:2,name:'FICTIONAL ACCOUNT',amount:100,status:'Not Paid',group:'Unpaid',payment:0,balance:100,textAmount:true}];
const fixture=`<style>:root{color:black}</style><nav class="nav">Sections</nav><main><button onclick="window.print()">Print</button></main><script>const records = ${JSON.stringify(records)};document.getElementById('actionBody');function csvCell(){}</script>`;
test('Admin and Finance access remains distinct from the Head of Operations portal',async()=>{
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

test('both authorized Head of Operations session types can read their isolated Collections endpoints',async()=>{
 for(const viewerRole of ['viewer','registration_viewer']){
  let response='',headers,status;
  const res={setHeader(){},writeHead(code,value){status=code;headers=value;},end(value){response=value;}};
  const pool={query:async()=>({rows:[{payload:{records,summary:{}},presentation:{html:'',css:'',script:''}}]})};
  await collectionsRoutes({method:'GET'},res,'/api/operations/collections',new URL('http://localhost/api/operations/collections'),{role:null,viewerRole,pool});
  assert.equal(status,200);assert.equal(JSON.parse(response).records[0].name,'FICTIONAL ACCOUNT');
  await collectionsRoutes({method:'GET'},res,'/api/operations/collections/dashboard.js',new URL('http://localhost/api/operations/collections/dashboard.js'),{role:null,viewerRole,pool});
  assert.match(response,/fetch\('\/api\/operations\/collections'/);
  await collectionsRoutes({method:'GET'},res,'/operations/collections',new URL('http://localhost/operations/collections'),{role:null,viewerRole,pool});
  assert.match(response,/Head of Operations/);assert.match(response,/href="\/operations\/collections"/);
  await assert.rejects(collectionsRoutes({method:'POST'},res,'/api/operations/collections',new URL('http://localhost/api/operations/collections'),{role:null,viewerRole,pool}),e=>e.status===405);
 }
});
test('unknown or missing portal roles cannot access financial data',async()=>{
 for(const viewerRole of [null,'unknown'])await assert.rejects(collectionsRoutes({method:'GET'},{},'/api/operations/collections',new URL('http://localhost/api/operations/collections'),{role:null,viewerRole,pool:{query(){throw new Error('Must not query');}}}),e=>e.status===(viewerRole?403:401));
});

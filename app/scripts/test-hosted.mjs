// Uses a disposable PostgreSQL container; never connects to the local CMS database.
import {spawnSync,spawn} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import http from 'node:http';
import {deflateSync} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hashViewerPassword} from '../security.mjs';
import {PDFDocument} from 'pdf-lib';
const docker=process.env.DOCKER||'/Applications/Docker.app/Contents/Resources/bin/docker';
const name='satima-hosting-test-'+randomBytes(4).toString('hex');
const secret=randomBytes(24).toString('hex'),appSecret=randomBytes(24).toString('hex'),cmsSecret=randomBytes(9).toString('base64url').slice(0,9),viewerSecret=randomBytes(9).toString('base64url').slice(0,9),registrationSecret=randomBytes(18).toString('base64url');
function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^(-(value&1)&0xedb88320);}return (value^0xffffffff)>>>0;}
function pngChunk(type,data){const tag=Buffer.from(type),result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);tag.copy(result,4);data.copy(result,8);result.writeUInt32BE(crc32(Buffer.concat([tag,data])),data.length+8);return result;}
function pngPixel(r,g,b){const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(Buffer.from([0,r,g,b]))),pngChunk('IEND',Buffer.alloc(0))]);}
let server,localServer,db,phase='startup',serverLog='';
function run(args,options={}){const r=spawnSync(docker,args,{encoding:'utf8',...options});if(r.status!==0)throw new Error('Docker test command failed');return r.stdout.trim();}
function migration(env){const r=spawnSync(process.execPath,['app/scripts/migrate-hosted.mjs'],{env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);}
try{
 run(['run','--rm','-d','--name',name,'-e','POSTGRES_PASSWORD','-p','127.0.0.1::5432','postgres:18.6'],{env:{...process.env,POSTGRES_PASSWORD:secret}});
 const port=run(['port',name,'5432/tcp']).split(':').at(-1);
 for(let n=0;n<80;n++){if(spawnSync(docker,['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore'}).status===0)break;await delay(250);}
 db=new pg.Client({connectionString:`postgresql://postgres:${secret}@127.0.0.1:${port}/postgres`});await db.connect();
 // Exercise migrations as an ordinary database owner with CREATEROLE, not superuser.
 await db.query('CREATE ROLE satima_admin LOGIN CREATEROLE PASSWORD '+pg.escapeLiteral(secret));
 await db.query('CREATE DATABASE satima_cms OWNER satima_admin');
 const env={...process.env,ADMIN_DATABASE_URL:`postgresql://satima_admin:${secret}@127.0.0.1:${port}/satima_cms`,APP_DB_PASSWORD:appSecret,CMS_PASSWORD:cmsSecret,VIEWER_USERNAME:'operations',VIEWER_PASSWORD_HASH:await hashViewerPassword(viewerSecret),REGISTRATION_VIEWER_USERNAME:'registration-review',REGISTRATION_VIEWER_PASSWORD_HASH:await hashViewerPassword(registrationSecret),PORT:'31987',PUBLIC_ORIGIN:'https://satima.example',RENDER:'true'};
 migration(env);migration(env);
 env.DATABASE_URL=`postgresql://satima_app:${appSecret}@127.0.0.1:${port}/satima_cms`;
 delete env.ADMIN_DATABASE_URL;delete env.APP_DB_PASSWORD;
 server=spawn(process.execPath,['app/scripts/start-hosted.mjs'],{env,stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',chunk=>{serverLog+=chunk.toString();});
 for(let n=0;n<80;n++){try{if((await fetch('http://127.0.0.1:31987/health')).status===200)break;}catch{}await delay(100);}
 const request=(path,options={})=>new Promise((resolve,reject)=>{
  const r=http.request('http://127.0.0.1:31987'+path,{method:options.method||'GET',headers:{Host:'satima.example',...options.headers}},res=>{const data=[];res.on('data',b=>data.push(b));res.on('end',()=>resolve(new Response(Buffer.concat(data),{status:res.statusCode,headers:res.headers})));});
  r.on('error',reject);r.end(options.body);
 });
 for(const route of ['/farmers/all','/farmers/registered','/farmers/not-registered','/farmers/category/satima','/farmers/category/larger-sagana','/farmers/category/kangema','/farmers/category/others','/farmers/awaiting-categorization','/farmers/flagged-records','/farmers/kra-verification','/milk-collection','/customers/category/current','/customers/category/lapsed','/customers/category/geographically-isolated','/customers/category/dormant','/customers/category/retired','/customers/awaiting-categorisation']){
const response=await request(route);assert.equal(response.status,200,route);assert.match(response.headers.get('content-type'),/text\/html/);assert.match(await response.text(),/id="directory"/);
 }
 for(const route of ['/operations','/operations/login','/operations/farmers/all','/operations/farmers/registered','/operations/farmers/not-registered','/operations/milk-collection','/operations/customers','/operations/distributors','/operations/category/satima','/operations/category/larger-sagana','/operations/category/kangema','/operations/category/others','/operations/kra-verification','/operations/customers/category/current','/operations/customers/category/lapsed','/operations/customers/category/geographically-isolated','/operations/customers/category/dormant','/operations/customers/category/retired','/operations/customers/awaiting-categorisation']){
const response=await request(route);assert.equal(response.status,200,route);assert.match(await response.text(),/Morning Dew Operations Portal/);
 }
 for(const base of ['/farmers/kra-verification','/operations/kra-verification']){
  for(const bucket of ['all','verified','pending','invalid','missing','review']){
   const route=base+'/'+bucket,response=await request(route);
   assert.equal(response.status,200,route);
   assert.match(await response.text(),/id="kra-page-title"/,route);
  }
 }
 for(const base of ['', '/operations']){
  for(const path of ['/milk-processing','/milk-processing/new','/milk-processing/category/satima','/milk-processing/awaiting-categorisation','/milk-distribution','/milk-distribution/new']){
   const response=await request(base+path);assert.equal(response.status,200,base+path);assert.match(await response.text(),/id="milk-operations-content"/);
  }
 }
 assert.equal((await request('/milk-operations.js')).status,200);
 assert.equal((await request('/api/milk-processing/collections')).status,401);
 assert.equal((await request('/api/operations/milk-processing/collections')).status,401);
 assert.equal((await request('/api/milk-distribution/records')).status,401);
 assert.equal((await request('/api/operations/milk-distribution/records')).status,401);
 for(const base of ['/milk-collection','/operations/milk-collection']){
  for(const slug of ['satima','larger-sagana','kangema','others']){
   const route=base+'/category/'+slug,response=await request(route);
   assert.equal(response.status,200,route);
   assert.match(await response.text(),/id="milk-content"/,route);
  }
  const route=base+'/awaiting-categorisation',response=await request(route);
  assert.equal(response.status,200,route);
  assert.match(await response.text(),/id="milk-content"/,route);
 }
 const adminPage=await (await request('/')).text(),operationsPage=await (await request('/operations')).text();
 assert.match(adminPage,/<title>Satima Farmhouse CMS · Admin<\/title>/);
 assert.match(operationsPage,/<title>Satima Farmhouse CMS · Operations<\/title>/);
 for(const [route,type] of [['/favicon.ico','image/x-icon'],['/favicon-32.png','image/png'],['/apple-touch-icon.png','image/png'],['/icon-192.png','image/png'],['/icon-512.png','image/png'],['/site.webmanifest','application/manifest+json']]){
  const response=await request(route);assert.equal(response.status,200,route);assert.equal(response.headers.get('content-type'),type,route);assert.ok((await response.arrayBuffer()).byteLength>0,route);
 }
assert.equal((await request('/api/farmers')).status,401);
 assert.equal((await request('/api/flagged-records')).status,401);
 assert.equal((await request('/api/operations/flagged-records')).status,401);
assert.equal((await request('/api/customers')).status,401);
assert.equal((await request('/api/operations/customers')).status,401);
assert.equal((await request('/api/milk-collections')).status,401);
assert.equal((await request('/api/operations/milk-collections')).status,401);
 assert.equal((await request('/api/kra-verification')).status,401);
 assert.equal((await request('/api/operations/kra-verification')).status,401);
 assert.match((await request('/')).headers.get('content-security-policy'),/img-src 'self' data: blob:/,'Local photograph previews are permitted');
assert.equal((await fetch('http://127.0.0.1:31987/')).status,403);
assert.equal((await request('/api/login',{method:'POST',headers:{Origin:'http://satima.example'},body:'{}'})).status,403);
const adminMissingUsername=await request('/api/login',{method:'POST',headers:{Origin:'https://satima.example'},body:JSON.stringify({password:cmsSecret})});
assert.equal(adminMissingUsername.status,400);assert.equal((await adminMissingUsername.json()).error,'Please enter your username.');
const adminMissingPassword=await request('/api/login',{method:'POST',headers:{Origin:'https://satima.example'},body:JSON.stringify({username:'admin'})});
assert.equal(adminMissingPassword.status,400);assert.equal((await adminMissingPassword.json()).error,'Please enter your password.');
const adminWrongUsername=await request('/api/login',{method:'POST',headers:{Origin:'https://satima.example'},body:JSON.stringify({username:'operations',password:cmsSecret})});
const adminWrongPassword=await request('/api/login',{method:'POST',headers:{Origin:'https://satima.example'},body:JSON.stringify({username:'admin',password:'incorrect-password'})});
assert.equal(adminWrongUsername.status,401);assert.equal(adminWrongPassword.status,401);
assert.equal((await adminWrongUsername.json()).error,(await adminWrongPassword.json()).error,'Login errors must not identify which credential was wrong');
 phase='administrator login';
 const login=await request('/api/login',{method:'POST',headers:{Origin:'https://satima.example'},body:JSON.stringify({username:'admin',password:cmsSecret})});
assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/; Secure/);
 const headers={Origin:'https://satima.example',Cookie:login.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 phase='administrator draft and farmer workflow';
 const draftCookie=login.headers.get('set-cookie').match(/satima_draft_device=[a-f0-9]{64}/)?.[0];
 assert.ok(draftCookie,'Sign-in issues a private draft device cookie');
 const draftHeaders={...headers,Cookie:headers.Cookie+'; '+draftCookie};
 phase='draft write';
 assert.equal((await request('/api/drafts/farmer-registration',{method:'PUT',headers:draftHeaders,body:JSON.stringify({content:{full_name:'Unfinished form'}})})).status,200);
 phase='draft read';
 assert.equal((await (await request('/api/drafts/farmer-registration',{headers:draftHeaders})).json()).content.full_name,'Unfinished form');
 phase='farmer workflow after draft';
const created=await request('/api/farmers',{method:'POST',headers,body:JSON.stringify({full_name:'HOSTED TEST ONLY',primary_phone:'TEST-PHONE-SEARCH',registered_by:'TEST',village_area:'TEST VILLAGE',county:'TEST COUNTY',location:'TEST LOCATION',sub_location:'TEST SUBLOCATION',sub_county:'TEST SUBCOUNTY',physical_address:'TEST ADDRESS',national_id:'PRIVATE-NATIONAL-ID',kra_pin:'PRIVATE-KRA-PIN',category:'Satima Farmers',contact:{full_name:'PRIVATE NEXT OF KIN',phone_number:'PRIVATE KIN PHONE',relationship:'TEST'},payment:{mpesa_registered_name:'PRIVATE MPESA NAME',mpesa_phone_number:'PRIVATE MPESA PHONE'}})});
assert.equal(created.status,201);const farmer=await created.json();
 const kraPath='/api/kra-verification/'+farmer.id;
 const initialKra=await (await request('/api/kra-verification',{headers})).json();assert.equal(initialKra.stats.total,1);assert.equal(initialKra.stats.invalid,1);assert.equal(initialKra.stats.verified,0);
 assert.equal(initialKra.records[0].format,'invalid');assert.equal((await request(kraPath,{headers})).status,200);
 assert.equal((await request(kraPath,{method:'POST',headers,body:JSON.stringify({outcome:'verified',taxpayer_name:'TEST',pin_status:'Active',checked_at:'2026-10-12',checked_by:'TEST',expected_pin:'PRIVATE-KRA-PIN',expected_revision:null})})).status,400);
let detail=await (await request('/api/farmers/'+farmer.id,{headers})).json();
 assert.equal(detail.gender,'not_verified');assert.equal(detail.gender_source,null);assert.equal(detail.has_photograph,false);
 assert.equal(detail.date_of_birth,null);assert.equal(detail.preferred_language,null);
 assert.equal((await request('/api/farmers/'+farmer.id,{method:'PUT',headers,body:JSON.stringify({...detail,date_of_birth:'2026-02-30'})})).status,400);
 assert.equal((await request('/api/farmers/'+farmer.id,{method:'PUT',headers,body:JSON.stringify({...detail,preferred_language:'French'})})).status,400);
 assert.equal((await request('/api/farmers/'+farmer.id,{method:'PUT',headers,body:JSON.stringify({...detail,date_of_birth:'1990-04-05',preferred_language:'Kiswahili'})})).status,200);
 detail=await (await request('/api/farmers/'+farmer.id,{headers})).json();
 assert.equal(detail.date_of_birth,'1990-04-05');assert.equal(detail.preferred_language,'Kiswahili');
 assert.equal((await (await request('/api/farmers?q=Kiswahili',{headers})).json()).stats.total,1);
 assert.equal((await (await request('/api/farmers?gender=not_verified',{headers})).json()).stats.total,1);
 assert.equal((await (await request('/api/farmers?q=Not%20verified',{headers})).json()).stats.total,1);
 assert.equal((await request('/api/farmers?gender=unknown',{headers})).status,400);
 assert.equal((await request('/api/farmers/'+farmer.id,{method:'PUT',headers,body:JSON.stringify({...detail,gender:'male'})})).status,400,'Verified gender requires a source');
 assert.equal((await request('/api/farmers/'+farmer.id,{method:'PUT',headers,body:JSON.stringify({...detail,gender:'male',gender_source:'farmer_confirmation'})})).status,200);
 detail=await (await request('/api/farmers/'+farmer.id,{headers})).json();
 assert.equal(detail.gender,'male');assert.equal(detail.gender_source,'farmer_confirmation');assert.ok(detail.gender_verified_at);
 assert.equal((await (await request('/api/farmers?gender=male&q=Male',{headers})).json()).stats.total,1);
 assert.equal((await (await request('/api/farmers?gender=female',{headers})).json()).stats.total,0);
 assert.equal((await request('/api/farmers/'+farmer.id,{method:'PUT',headers,body:JSON.stringify({...detail,full_name:'HOSTED UPDATED'})})).status,200);
 const results=await (await request('/api/farmers?q=HOSTED%20UPDATED',{headers})).json();assert.equal(results.stats.total,1);
 detail=await (await request('/api/farmers/'+farmer.id,{headers})).json();
 const photoPath='/api/farmers/'+farmer.id+'/photo',viewerPhotoPath='/api/operations/farmers/'+farmer.id+'/photo';
 const firstPhoto=pngPixel(120,60,30),replacementPhoto=pngPixel(30,120,60);
 assert.equal((await request(photoPath)).status,401);
 assert.equal((await request(photoPath,{method:'PUT',headers:{...headers,Origin:'https://other.example','Content-Type':'image/png'},body:firstPhoto})).status,403);
 assert.equal((await request(photoPath,{method:'PUT',headers:{...headers,'Content-Type':'text/plain'},body:firstPhoto})).status,415);
 assert.equal((await request(photoPath,{method:'PUT',headers:{...headers,'Content-Type':'image/png'},body:Buffer.from('not an image')})).status,400);
 assert.equal((await request(photoPath,{method:'PUT',headers:{...headers,'Content-Type':'image/png'},body:Buffer.alloc(10*1024*1024+1)})).status,413);
 const largePhoto=Buffer.concat([firstPhoto.subarray(0,-12),pngChunk('tEXt',Buffer.concat([Buffer.from('Comment\0'),Buffer.alloc(2*1024*1024+1024,65)])),firstPhoto.subarray(-12)]);
 assert.ok(largePhoto.length>2*1024*1024);
 assert.equal((await request(photoPath,{method:'PUT',headers:{...headers,'Content-Type':'image/png'},body:largePhoto})).status,200,'A valid photo larger than the old 2 MB limit uploads');
 assert.equal((await request(photoPath,{method:'PUT',headers:{...headers,'Content-Type':'image/png'},body:firstPhoto})).status,200);
 assert.equal((await (await request('/api/farmers/'+farmer.id,{headers})).json()).has_photograph,true);
 const firstRead=await request(photoPath,{headers});assert.equal(firstRead.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await firstRead.arrayBuffer()),firstPhoto);
 assert.equal((await request(photoPath,{method:'PUT',headers:{...headers,'Content-Type':'image/png'},body:replacementPhoto})).status,200);
 assert.deepEqual(Buffer.from(await (await request(photoPath,{headers})).arrayBuffer()),replacementPhoto);
 const blocked=await request('/api/farmers/'+farmer.id,{method:'PUT',headers,body:JSON.stringify({...detail,status:'active'})});assert.equal(blocked.status,400);assert.match((await blocked.json()).error,/Active status requires/);
 assert.equal((await (await request('/api/farmers/'+farmer.id,{headers})).json()).status,'pending_verification');
 assert.deepEqual(Buffer.from(await (await request(photoPath,{headers})).arrayBuffer()),replacementPhoto,'Farmer edits preserve the photograph');
 for(const query of ['HOSTED UPDATED',farmer.customer_id,'TEST-PHONE-SEARCH','PRIVATE-KRA-PIN','TEST VILLAGE','TEST COUNTY','TEST LOCATION','TEST SUBLOCATION','TEST SUBCOUNTY','TEST ADDRESS','Pending verification','pending_verification','No open notes']){
  const response=await request('/api/farmers?'+new URLSearchParams({q:query}),{headers});assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.stats.total,1,'Search: '+query);assert.equal(data.farmers[0].id,farmer.id);
 }
 const note=await request('/api/farmers/'+farmer.id+'/issues',{method:'POST',headers,body:JSON.stringify({field_name:'location',description:'TEST REVIEW ONLY'})});assert.equal(note.status,201);
 const reviewed=await (await request('/api/farmers?q=1%20open',{headers})).json();assert.equal(reviewed.stats.total,1);assert.equal(reviewed.farmers[0].open_issues,1);
 assert.equal((await request('/api/operations/farmers')).status,401);
 assert.equal((await request('/api/operations/farmers',{headers})).status,401,'Administrator cookie is not a viewer session');
 const operationsMissingUsername=await request('/api/operations/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({password:viewerSecret})});
 assert.equal(operationsMissingUsername.status,400);assert.equal((await operationsMissingUsername.json()).error,'Please enter your username.');
 const operationsMissingPassword=await request('/api/operations/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({username:'operations'})});
 assert.equal(operationsMissingPassword.status,400);assert.equal((await operationsMissingPassword.json()).error,'Please enter your password.');
 const operationsWrongUsername=await request('/api/operations/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({username:'wrong',password:viewerSecret})});
 const operationsWrongPassword=await request('/api/operations/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({username:'operations',password:'incorrect-password'})});
 assert.equal(operationsWrongUsername.status,401);assert.equal(operationsWrongPassword.status,401);
 assert.equal((await operationsWrongUsername.json()).error,(await operationsWrongPassword.json()).error,'Operations login errors must not identify which credential was wrong');
 assert.equal((await request('/api/operations/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({username:'operations-viewer',password:viewerSecret})})).status,401,'Old viewer username must be rejected');
 phase='operations login';
 const viewerLogin=await request('/api/operations/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({username:'operations',password:viewerSecret})});
 assert.equal(viewerLogin.status,200);assert.match(viewerLogin.headers.get('set-cookie'),/HttpOnly.*SameSite=Strict.*Secure/);
 const viewerHeaders={Origin:'https://satima.example',Cookie:viewerLogin.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 phase='home and support';
 for(const route of ['/farmers','/contact-support','/operations/farmers','/operations/contact-support'])assert.equal((await request(route)).status,200,route);
 assert.equal((await request('/api/home')).status,401);
 assert.equal((await request('/api/operations/home')).status,401);
 const adminHome=await request('/api/home?period=today',{headers});assert.equal(adminHome.status,200);const dashboard=await adminHome.json();assert.ok(dashboard.network&&dashboard.operations&&dashboard.range);
 assert.equal((await request('/api/operations/home?period=month',{headers:viewerHeaders})).status,200);
 assert.equal((await request('/api/home?period=custom&from=2026-02-30&to=2026-10-16',{headers})).status,400);
 const supportBody=JSON.stringify({idempotency_key:randomUUID(),category:'Milk Collection Issue',subject:'Collection form issue',description:'The test collection form is unavailable.',requester_name:'Fictional Operator',contact_email:'operator@example.test',priority:'Normal'});
 assert.equal((await request('/api/operations/support',{method:'POST',headers:viewerHeaders,body:'{}'})).status,400);
 const submitted=await request('/api/operations/support',{method:'POST',headers:viewerHeaders,body:supportBody});assert.equal(submitted.status,201);const submittedData=await submitted.json();assert.match(submittedData.ticket_reference,/^SF-SUP-\d+$/);assert.equal(submittedData.notification_status,'pending');
 const repeat=await request('/api/operations/support',{method:'POST',headers:viewerHeaders,body:supportBody});assert.equal(repeat.status,200);assert.equal((await repeat.json()).ticket_reference,submittedData.ticket_reference);
 assert.equal((await request('/api/operations/support/tickets',{headers:viewerHeaders})).status,404);
 const ticketList=await request('/api/support/tickets',{headers});assert.equal(ticketList.status,200);const ticket=(await ticketList.json()).tickets.find(t=>t.ticket_reference===submittedData.ticket_reference);assert.ok(ticket);assert.equal(ticket.source_portal,'Operations');
 const ticketDetail=await request('/api/support/tickets/'+ticket.id,{headers});assert.equal(ticketDetail.status,200);assert.equal((await ticketDetail.json()).history.length,1);
 const ticketUpdated=await request('/api/support/tickets/'+ticket.id,{method:'PATCH',headers,body:JSON.stringify({status:'In Progress',note:'Reviewing synthetic test issue',revision:ticket.revision})});assert.equal(ticketUpdated.status,200);
 assert.equal((await request('/api/support/tickets/'+ticket.id,{method:'PATCH',headers,body:JSON.stringify({status:'Closed',revision:ticket.revision})})).status,409);
 assert.equal((await request('/api/operations/drafts/farmer-registration',{headers:viewerHeaders})).status,403);
 const viewerDevice=viewerLogin.headers.get('set-cookie').match(/satima_draft_device=[a-f0-9]{64}/)?.[0];assert.ok(viewerDevice);
 const viewerDraftHeaders={...viewerHeaders,Cookie:viewerHeaders.Cookie+'; '+viewerDevice};
 assert.equal((await request('/api/operations/drafts/milk-collection',{method:'PUT',headers:viewerDraftHeaders,body:JSON.stringify({content:{quantity:'2.5'}})})).status,200);
 assert.equal((await (await request('/api/operations/drafts/milk-collection',{headers:viewerDraftHeaders})).json()).content.quantity,'2.5');
 const customerDb=new pg.Client({connectionString:`postgresql://satima_admin:${secret}@127.0.0.1:${port}/satima_cms`});await customerDb.connect();
 const customerOne=(await customerDb.query("INSERT INTO customers(full_name,physical_address,phone_number,source_sha256) VALUES('TEST ALPHA','TEST ADDRESS','0712345678',$1) RETURNING id,customer_id",['a'.repeat(64)])).rows[0];
 const customerTwo=(await customerDb.query("INSERT INTO customers(full_name,physical_address,phone_number,gender,source_sha256) VALUES('TEST BETA','SECOND ADDRESS',NULL,'female',$1) RETURNING id,customer_id",['a'.repeat(64)])).rows[0];
 await customerDb.query('UPDATE customers SET category=$2 WHERE id=$1',[customerOne.id,'Current Customers']);
 assert.equal(customerOne.customer_id,'C0001');assert.equal(customerTwo.customer_id,'C0002');
 await assert.rejects(customerDb.query('UPDATE customers SET customer_id=$2 WHERE id=$1',[customerOne.id,'C9999']),error=>error.code==='P0001');
 await customerDb.end();
 const adminCustomers=await (await request('/api/customers',{headers})).json();
 const operationsCustomers=await (await request('/api/operations/customers',{headers:viewerHeaders})).json();
 assert.equal(adminCustomers.total,2);assert.deepEqual(adminCustomers,operationsCustomers);
 assert.deepEqual(adminCustomers.customers.map(item=>item.customer_id),['C0001','C0002']);
 assert.equal(adminCustomers.stats.categories['Current Customers'],1);
 assert.equal(adminCustomers.stats.uncategorized,1);
 assert.equal(adminCustomers.customers[0].category,'Current Customers');
 assert.deepEqual(operationsCustomers.stats,adminCustomers.stats);
 assert.equal((await (await request('/api/customers?category=Current%20Customers',{headers})).json()).pagination.total,1);
 assert.equal((await (await request('/api/operations/customers?category=unassigned',{headers:viewerHeaders})).json()).pagination.total,1);
 assert.equal((await (await request('/api/customers?q=Current%20Customers',{headers})).json()).pagination.total,1);
 assert.equal((await request('/api/customers?category=unknown',{headers})).status,400);
 assert.equal(adminCustomers.customers[0].gender,null);
 assert.equal((await (await request('/api/customers?q=0712345678',{headers})).json()).pagination.total,1);
 assert.deepEqual((await (await request('/api/operations/customers?sort=full_name&direction=desc',{headers:viewerHeaders})).json()).customers.map(item=>item.customer_id),['C0002','C0001']);
 assert.equal((await request('/api/customers?sort=bad',{headers})).status,400);
 assert.equal((await request('/api/customers/'+customerOne.id,{headers})).status,200);
 assert.equal((await request('/api/operations/customers/'+customerOne.id,{headers:viewerHeaders})).status,200);
 assert.equal((await request('/api/operations/customers/'+customerOne.id,{method:'PUT',headers:viewerHeaders,body:'{}'})).status,403);
 const milkDay=(()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));return `${p.year}-${p.month}-${p.day}`;})();
 const milkImage=pngPixel(33,110,71),milkKey=randomUUID();
 const milkHeaders=(session,quantity,key,date=milkDay)=>({...session,'Content-Type':'image/png','X-Farmer-Id':farmer.id,'X-Quantity-Liters':quantity,'X-Date-Received':date,'X-Idempotency-Key':key});
 const emptyMilk=await (await request('/api/milk-collections/summary',{headers})).json();
 assert.equal(emptyMilk.totals.today_liters,'0');
 assert.equal(emptyMilk.daily.length,30);assert.equal(emptyMilk.weekly.length,12);assert.equal(emptyMilk.monthly.length,12);
 assert.ok(emptyMilk.daily.every(day=>Number(day.liters)===0));
 assert.equal((await (await request('/api/operations/milk-collections/farmers?q=HOSTED',{headers:viewerHeaders})).json())[0].id,farmer.id);
 assert.equal((await request('/api/operations/milk-collections',{method:'POST',headers:milkHeaders(viewerHeaders,'0',randomUUID()),body:milkImage})).status,400);
 assert.equal((await request('/api/operations/milk-collections',{method:'POST',headers:milkHeaders(viewerHeaders,'0.5',randomUUID(),'2030-01-01'),body:milkImage})).status,400);
 assert.equal((await request('/api/operations/milk-collections',{method:'POST',headers:milkHeaders(viewerHeaders,'0.5',randomUUID()),body:Buffer.from('not an image')})).status,400);
 const milkSaved=await request('/api/operations/milk-collections',{method:'POST',headers:milkHeaders(viewerHeaders,'0.5',milkKey),body:largePhoto});assert.equal(milkSaved.status,201,'Milk evidence also accepts photos larger than 2 MB');
 const firstMilk=await milkSaved.json();assert.match(firstMilk.collection_id,/^MC\d{6}$/);
 const milkRepeat=await request('/api/operations/milk-collections',{method:'POST',headers:milkHeaders(viewerHeaders,'0.5',milkKey),body:largePhoto});assert.equal(milkRepeat.status,200);assert.equal((await milkRepeat.json()).id,firstMilk.id);
 assert.equal((await request('/api/operations/milk-collections',{method:'POST',headers:milkHeaders(viewerHeaders,'0.75',milkKey),body:milkImage})).status,409);
 const adminMilk=await request('/api/milk-collections',{method:'POST',headers:milkHeaders(headers,'0.75',randomUUID()),body:milkImage});assert.equal(adminMilk.status,201);
 const secondMilk=await adminMilk.json();assert.notEqual(secondMilk.collection_id,firstMilk.collection_id);
 const bothMilk=await (await request('/api/milk-collections',{headers})).json();assert.equal(bothMilk.pagination.total,2);assert.equal(bothMilk.total_liters,'1.250000');
 const todayKpi=await (await request('/api/milk-collections?period=today',{headers})).json();assert.equal(todayKpi.pagination.total,2);assert.equal(todayKpi.total_liters,'1.250000');assert.equal(todayKpi.unique_farmers,1);
 const milkCategories=(await (await request('/api/milk-collections/summary',{headers})).json()).categories;
 assert.equal(milkCategories.find(item=>item.category==='Satima Farmers').deliveries,2);
 assert.deepEqual((await (await request('/api/operations/milk-collections/summary',{headers:viewerHeaders})).json()).categories,milkCategories);
 assert.equal((await (await request('/api/operations/milk-collections',{headers:viewerHeaders})).json()).pagination.total,2);
 assert.equal((await (await request('/api/milk-collections?period=today&farmer='+farmer.id,{headers})).json()).pagination.total,2);
 assert.equal((await (await request('/api/milk-collections?q='+firstMilk.collection_id+'&category='+encodeURIComponent('Satima Farmers')+'&sort=quantity_asc',{headers})).json()).pagination.total,1);
 assert.equal((await (await request('/api/operations/milk-collections/summary',{headers:viewerHeaders})).json()).totals.farmers_today,1);
 assert.equal((await (await request('/api/operations/farmers/'+farmer.id+'/milk-collections',{headers:viewerHeaders})).json()).totals.deliveries,2);
 assert.equal((await (await request('/api/milk-collections/'+firstMilk.id,{headers})).json()).farmer_id,farmer.id);
 const milkPhotoResponse=await request('/api/operations/milk-collections/'+firstMilk.id+'/photo',{headers:viewerHeaders});
 assert.equal(milkPhotoResponse.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(Buffer.from(await milkPhotoResponse.arrayBuffer()),largePhoto);
 assert.equal((await request('/api/operations/milk-collections/'+firstMilk.id+'/photo')).status,401);
 assert.equal((await request('/api/operations/milk-collections/'+firstMilk.id,{method:'DELETE',headers:viewerHeaders})).status,403);
 assert.equal((await request('/api/operations/farmers',{method:'POST',headers:viewerHeaders,body:'{}'})).status,403);
 assert.equal((await request('/api/kra-verification',{headers:viewerHeaders})).status,401);
 assert.equal((await request(kraPath,{method:'POST',headers:viewerHeaders,body:'{}'})).status,401);
 assert.equal((await request('/api/operations/session',{headers:viewerHeaders})).status,200);
 assert.equal((await request('/api/session',{headers:viewerHeaders})).status,401);
 const viewerList=await (await request('/api/operations/farmers',{headers:viewerHeaders})).json();
 assert.equal(viewerList.stats.total,1);assert.equal(viewerList.farmers[0].customer_id,farmer.customer_id);
 assert.equal(viewerList.farmers[0].kra_pin,'PRIVATE-KRA-PIN');
 assert.equal((await (await request('/api/operations/kra-verification',{headers:viewerHeaders})).json()).stats.invalid,1);
 assert.deepEqual(Object.keys(viewerList.farmers[0]).sort(),['category','county','customer_id','date_of_birth','full_name','gender','id','kra_pin','location','preferred_language','primary_phone','registration_date','registration_status','village_area'].sort());
 assert.equal(viewerList.farmers[0].date_of_birth,'1990-04-05');assert.equal(viewerList.farmers[0].preferred_language,'Kiswahili');
 assert.equal((await (await request('/api/operations/farmers?q=Kiswahili',{headers:viewerHeaders})).json()).stats.total,1);
 assert.equal(viewerList.farmers[0].gender,'male');
 assert.equal((await (await request('/api/operations/farmers?gender=male&q=Male',{headers:viewerHeaders})).json()).stats.total,1);
 assert.equal((await (await request('/api/operations/farmers?gender=female',{headers:viewerHeaders})).json()).stats.total,0);
 assert.equal((await request('/api/operations/farmers?gender=unknown',{headers:viewerHeaders})).status,400);
 const viewerDetail=await (await request('/api/operations/farmers/'+farmer.id,{headers:viewerHeaders})).json();
 assert.equal(viewerDetail.gender,'male');assert.equal(viewerDetail.has_photograph,true);assert.equal(viewerDetail.kra_pin,'PRIVATE-KRA-PIN');
 assert.equal(viewerDetail.date_of_birth,'1990-04-05');assert.equal(viewerDetail.preferred_language,'Kiswahili');
 assert(!Object.hasOwn(viewerDetail,'gender_source'));
 const sensitivePath='/api/operations/farmers/'+farmer.id+'/registration';
 assert.equal((await request(sensitivePath)).status,401);
 assert.equal((await request(sensitivePath,{headers:viewerHeaders})).status,403,'Ordinary Operations users cannot read sensitive registration fields');
 assert.equal((await request(sensitivePath,{headers})).status,401,'Administrator cookie is separate from Operations access');
 const testDb=new pg.Client({connectionString:`postgresql://satima_admin:${secret}@127.0.0.1:${port}/satima_cms`});await testDb.connect();
 // Apply the actual new migration to a legacy-shaped fixture, without touching production tables.
 await testDb.query('BEGIN');
 try{
  await testDb.query('CREATE SCHEMA migration_history');
  await testDb.query('SET LOCAL search_path TO migration_history,public');
  await testDb.query('CREATE TABLE milk_processing_batches(id uuid PRIMARY KEY,processed_liters numeric(16,6),bottled_liters numeric(16,6) NOT NULL,bottle_size_ml integer NOT NULL,bottles_produced integer NOT NULL)');
  await testDb.query('CREATE TABLE milk_distributions(id uuid PRIMARY KEY,batch_id uuid,bottles integer NOT NULL,status text)');
  const legacyBatch=randomUUID(),legacyRecord=randomUUID();
  await testDb.query('INSERT INTO milk_processing_batches VALUES($1,10,10,500,20)',[legacyBatch]);
  await testDb.query("INSERT INTO milk_distributions VALUES($1,$2,3,'dispatched')",[legacyRecord,legacyBatch]);
  await testDb.query(await readFile(new URL('../../database/migrations/031_litre_distribution.sql',import.meta.url),'utf8'));
  const {rows:[converted]}=await testDb.query('SELECT quantity_liters::text AS liters FROM milk_distributions WHERE id=$1',[legacyRecord]);
  assert.equal(converted.liters,'1.500000','Historical bottle records keep their litre equivalent');
 }finally{await testDb.query('ROLLBACK');}
 try{
  await testDb.query(`INSERT INTO farmer_registration_sources(farmer_id,document_name,document_sha256,first_page,last_page,raw_transcription) VALUES($1,$2,$3,1,2,$4)`,[farmer.id,'TEST FORM','a'.repeat(64),JSON.stringify({farmer_signature:'SIGNATURE TRANSCRIPTION'})]);
  await testDb.query(`INSERT INTO farmer_consents(farmer_id,consent_version,information_accuracy_confirmed,data_processing_consent,communications_consent,consent_given,signed_name,signature_method,consent_date) VALUES($1,'test',true,true,null,true,'SIGNED TEST NAME','signature',now())`,[farmer.id]);
  await testDb.query(`INSERT INTO farmer_verifications(farmer_id,verified_by,national_id_verified,notes) VALUES($1,'TEST OFFICER',true,'TEST VERIFICATION')`,[farmer.id]);
  const elevatedLogin=await request('/api/operations/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({username:'registration-review',password:registrationSecret})});
  assert.equal(elevatedLogin.status,200);
  const elevatedHeaders={Origin:'https://satima.example',Cookie:elevatedLogin.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
  const secondResponse=await request('/api/farmers',{method:'POST',headers,body:JSON.stringify({full_name:'SECOND ARCHIVE TEST',primary_phone:'SECOND-PHONE',registered_by:'TEST',category:'Others'})});
  assert.equal(secondResponse.status,201);const secondFarmer=await secondResponse.json();
  // Processing and distribution use the disposable database only.
  const processingBase='/api/milk-processing',operationsProcessing='/api/operations/milk-processing';
  const newCollection=async(farmerId,litersValue)=>{
   const response=await request('/api/operations/milk-collections',{method:'POST',headers:{...milkHeaders(viewerHeaders,litersValue,randomUUID()),'X-Farmer-Id':farmerId},body:milkImage});
   assert.equal(response.status,201);return response.json();
  };
  const five=await newCollection(farmer.id,'5'),seven=await newCollection(secondFarmer.id,'7'),ten=await newCollection(farmer.id,'10'),eight=await newCollection(farmer.id,'8');
  const orderedCollections=await (await request('/api/milk-processing/collections?sort=id',{headers})).json();
  const selectedCollections=await (await request('/api/milk-collections?'+new URLSearchParams({from:milkDay,to:milkDay}),{headers})).json();
  const selectedSummary=await (await request('/api/milk-collections/summary?'+new URLSearchParams({from:milkDay,to:milkDay}),{headers})).json();
  assert.equal(selectedSummary.totals.period_records,selectedCollections.pagination.total);
  assert.equal(selectedSummary.totals.unique_farmers,selectedCollections.unique_farmers);
  assert.equal(selectedSummary.categories.reduce((sum,category)=>sum+category.deliveries,0),selectedCollections.pagination.total);
  assert.deepEqual(orderedCollections.records.map(row=>row.collection_id),orderedCollections.records.map(row=>row.collection_id).sort());
  assert.equal((await request('/api/milk-processing/collections?sort=bad',{headers})).status,400);
  assert.equal((await request(processingBase+'/collections')).status,401);
  assert.equal((await request(operationsProcessing+'/collections',{headers})).status,401);
  assert.equal((await request('/api/operations/farmers',{method:'POST',headers:viewerHeaders,body:'{}'})).status,403);
  const saveCheck=async(collection,accepted,rejected,reason='',session=viewerHeaders)=>request(operationsProcessing+'/quality',{method:'POST',headers:session,body:JSON.stringify({collection_id:collection.id,accepted_liters:accepted,rejected_liters:rejected,rejection_reason:reason,inspected_on:milkDay,inspected_by:'Test Inspector',idempotency_key:randomUUID()})});
  assert.equal((await saveCheck(five,'4','2','Contamination')).status,400,'Accepted and rejected must equal received');
  assert.equal((await saveCheck(five,'3','-2','Contamination')).status,400,'Negative rejection is invalid');
  assert.equal((await saveCheck(five,'3','2')).status,400,'A rejection reason is required');
  assert.equal((await saveCheck(five,'3','2','Other')).status,400,'Other needs a note');
  assert.equal((await saveCheck(five,'3','2','Contamination')).status,201);
  assert.equal((await saveCheck(seven,'7','0')).status,201);
  assert.equal((await saveCheck(ten,'10','0')).status,201);
  assert.equal((await saveCheck(eight,'0','8','Spoilage')).status,201);
  const fiveDetail=await (await request(processingBase+'/collections/'+five.id,{headers})).json();
  assert.equal(fiveDetail.accepted_liters,'3.000000');assert.equal(fiveDetail.rejected_liters,'2.000000');
  const correctionPath=operationsProcessing+'/quality/'+fiveDetail.quality_id;
  const corrected=await request(correctionPath,{method:'PUT',headers:viewerHeaders,body:JSON.stringify({collection_id:five.id,accepted_liters:'2',rejected_liters:'3',rejection_reason:'Contamination',notes:'Retested against original delivery',inspected_on:milkDay,inspected_by:'Test Inspector',revision:fiveDetail.revision,idempotency_key:randomUUID()})});
  assert.equal(corrected.status,200,corrected.status===200?'':await corrected.text());const correction=await corrected.json();
  assert.equal((await request(correctionPath,{method:'PUT',headers:viewerHeaders,body:JSON.stringify({collection_id:five.id,accepted_liters:'3',rejected_liters:'2',rejection_reason:'Contamination',inspected_on:milkDay,inspected_by:'Test Inspector',revision:fiveDetail.revision,idempotency_key:randomUUID()})})).status,409,'Stale quality correction is rejected');
  assert.equal((await request(processingBase+'/quality/'+fiveDetail.quality_id,{method:'PUT',headers,body:JSON.stringify({collection_id:five.id,accepted_liters:'3',rejected_liters:'2',rejection_reason:'Contamination',inspected_on:milkDay,inspected_by:'Test Inspector',revision:correction.revision,idempotency_key:randomUUID()})})).status,200);
  assert.equal((await (await request(processingBase+'/collections/'+five.id,{headers})).json()).accepted_liters,'3.000000');
  const acceptedKpi=await (await request(processingBase+'/collections?metric=accepted',{headers})).json();assert.ok(acceptedKpi.records.some(row=>row.id===five.id));assert.ok(acceptedKpi.records.every(row=>Number(row.accepted_liters)>0));
  const rejectedKpi=await (await request(operationsProcessing+'/collections?metric=rejected',{headers:viewerHeaders})).json();assert.ok(rejectedKpi.records.some(row=>row.id===eight.id));assert.ok(rejectedKpi.records.every(row=>Number(row.rejected_liters)>0));
  assert.equal((await (await request('/api/operations/milk-operation-audit/quality/'+fiveDetail.quality_id,{headers:viewerHeaders})).json()).length,3);
  const farmerHistory=await (await request(operationsProcessing.replace('/milk-processing','')+'/farmers/'+farmer.id+'/milk-processing',{headers:viewerHeaders})).json();
  assert.ok(Number(farmerHistory.totals.rejected_liters)>=10);
  const createBatch=(allocations,processed,key=randomUUID())=>request(operationsProcessing+'/batches',{method:'POST',headers:viewerHeaders,body:JSON.stringify({processed_on:milkDay,allocations,processed_liters:processed,product_format:'Fresh milk',operator_name:'Test Processor',idempotency_key:key})});
  assert.equal((await createBatch([{collection_id:eight.id,quantity_liters:'1'}],'1')).status,409,'Rejected milk cannot enter processing');
  assert.equal((await createBatch([{collection_id:five.id,quantity_liters:'4'}],'4')).status,409,'Cannot allocate more than accepted');
  const batchKey=randomUUID(),batchResponse=await createBatch([{collection_id:five.id,quantity_liters:'3'},{collection_id:seven.id,quantity_liters:'7'}],'10',batchKey);
  assert.equal(batchResponse.status,201);const mixedBatch=await batchResponse.json();
  assert.equal((await createBatch([{collection_id:five.id,quantity_liters:'3'},{collection_id:seven.id,quantity_liters:'7'}],'10',batchKey)).status,200,'Retry does not duplicate batch');
  assert.equal((await createBatch([{collection_id:five.id,quantity_liters:'1'}],'1')).status,409,'Previously allocated milk cannot be allocated again');
  const mixedDetail=await (await request(processingBase+'/batches/'+mixedBatch.id,{headers})).json();
  assert.equal((await request(processingBase+'/batches?sort=id',{headers})).status,200);
  assert.deepEqual(mixedDetail.allocations.map(row=>row.farmer_id).sort(),[farmer.id,secondFarmer.id].sort());
  assert.equal(mixedDetail.processed_liters,'10.000000');assert.equal(mixedDetail.available_liters,'10.000000');
  // During a rolling deploy, an older instance can still insert bottle records.
  await testDb.query('BEGIN');
  try{
   await testDb.query('UPDATE milk_processing_batches SET bottled_liters=10,bottle_size_ml=500,bottles_produced=20 WHERE id=$1',[mixedBatch.id]);
   const {rows:[legacy]}=await testDb.query("INSERT INTO milk_distributions(batch_id,customer_id,recipient_type,distributed_on,bottles,status,operator_name,recorded_by,source_portal,idempotency_key) VALUES($1,$2,'customer',$3,2,'draft','Test Dispatcher','Test','Operations',$4) RETURNING quantity_liters::text AS liters",[mixedBatch.id,customerOne.id,milkDay,randomUUID()]);
   assert.equal(legacy.liters,'1.000000','Legacy bottle insert retains its exact litre equivalent');
  }finally{await testDb.query('ROLLBACK');}
  assert.equal((await (await request(processingBase+'/batches?metric=processed',{headers})).json()).pagination.total,1);
  const distributionBase='/api/operations/milk-distribution';
  const {rows:[testParent]}=await testDb.query("INSERT INTO distributors(name,record_type,source_sha256) VALUES('Test Group','distributor',$1) RETURNING id",['a'.repeat(64)]);
  const {rows:[testStore]}=await testDb.query("INSERT INTO distributors(name,record_type,parent_id,source_sha256) VALUES('Test Store','store',$1,$2) RETURNING id",[testParent.id,'a'.repeat(64)]);
  for(const path of ['/distributors/type/store','/distributors/'+testStore.id,'/operations/distributors/type/store','/operations/distributors/'+testStore.id])assert.equal((await request(path)).status,200,path);
  assert.equal((await request('/api/distributors')).status,401);
  assert.equal((await (await request('/api/distributors',{headers})).json()).stats.stores,1);
  const recipientStats=(await (await request('/api/distributors',{headers})).json()).stats;
  assert.equal(recipientStats.distributors,1,'Parent distributor is counted separately from its store');
  assert.equal(recipientStats.stores,1);
  assert.equal((await (await request('/api/operations/distributors?type=store&q=Test',{headers:viewerHeaders})).json()).pagination.total,1);
  assert.equal((await request('/api/operations/distributors/'+testStore.id,{method:'PATCH',headers:viewerHeaders,body:'{}'})).status,403);
  const storeDetail=await (await request('/api/distributors/'+testStore.id,{headers})).json();
  assert.equal((await request('/api/distributors/'+testStore.id,{method:'PATCH',headers,body:JSON.stringify({...storeDetail,name:'Test Store Updated'})})).status,200);
  assert.equal((await request('/api/distributors/'+testStore.id,{method:'PATCH',headers,body:JSON.stringify({...storeDetail,name:'Stale Update'})})).status,409);
  const distribute=(batchId,countValue,statusValue,submitKey=randomUUID())=>request(distributionBase+'/records',{method:'POST',headers:viewerHeaders,body:JSON.stringify({batch_id:batchId,customer_id:customerOne.id,distributed_on:milkDay,quantity_liters:countValue,status:statusValue,operator_name:'Test Dispatcher',idempotency_key:submitKey})});
  const distributeStore=(batchId,countValue,statusValue,submitKey=randomUUID())=>request(distributionBase+'/records',{method:'POST',headers:viewerHeaders,body:JSON.stringify({batch_id:batchId,recipient_type:'distributor',distributor_id:testStore.id,distributed_on:milkDay,quantity_liters:countValue,status:statusValue,operator_name:'Test Dispatcher',idempotency_key:submitKey})});
  assert.equal((await request(distributionBase+'/records',{method:'POST',headers:viewerHeaders,body:JSON.stringify({batch_id:mixedBatch.id,recipient_type:'distributor',distributor_id:testParent.id,distributed_on:milkDay,quantity_liters:'1',status:'draft',operator_name:'Test Dispatcher',idempotency_key:randomUUID()})})).status,404,'Parent distributor is not a delivery store');
  const storeDraft=await distributeStore(mixedBatch.id,2,'draft');assert.equal(storeDraft.status,201);
  const storeSaved=await storeDraft.json();assert.equal((await (await request('/api/operations/distributors/'+testStore.id+'/milk-distributions',{headers:viewerHeaders})).json()).pagination.total,1);
  assert.equal((await (await request('/api/distributors/'+testParent.id+'/milk-distributions',{headers})).json()).pagination.total,1,'Parent history includes its store deliveries');
  assert.equal((await (await request(processingBase+'/batches/'+mixedBatch.id,{headers})).json()).available_liters,'10.000000','Draft store delivery leaves inventory available');
  const storeRecord=await (await request('/api/milk-distribution/records/'+storeSaved.id,{headers})).json();assert.equal(storeRecord.distributor_name,'Test Store Updated');
  assert.equal((await distribute(randomUUID(),1,'dispatched')).status,404);
  assert.equal((await distribute(mixedBatch.id,11,'dispatched')).status,409,'Cannot dispatch more than produced');
  const distributionKey=randomUUID(),distributionResponse=await distribute(mixedBatch.id,5,'dispatched',distributionKey);
  assert.equal(distributionResponse.status,201);const dispatched=await distributionResponse.json();
  const dispatchedOnly=await (await request(distributionBase+'/records?status=dispatched',{headers:viewerHeaders})).json();
  assert.ok(dispatchedOnly.records.every(record=>record.status==='dispatched'));
  assert.equal((await request(distributionBase+'/records?status=unknown',{headers:viewerHeaders})).status,400);
  assert.equal((await distribute(mixedBatch.id,5,'dispatched',distributionKey)).status,200);
  assert.equal((await (await request(processingBase+'/batches/'+mixedBatch.id,{headers})).json()).available_liters,'5.000000');
  const distributedKpi=await (await request('/api/milk-distribution/records?metric=distributed',{headers})).json();assert.equal(distributedKpi.pagination.total,1,'Draft records do not count as distributed');
  assert.equal((await (await request('/api/milk-distribution/records?metric=distributed&recipient_type=customer',{headers})).json()).pagination.total,1);
  assert.equal((await (await request('/api/milk-distribution/records?metric=distributed&recipient_type=distributor',{headers})).json()).pagination.total,0);
  assert.equal((await (await request(processingBase+'/batches?metric=remaining',{headers})).json()).records[0].available_liters,'5.000000');
  const dispatchDetail=await (await request(distributionBase+'/records/'+dispatched.id,{headers:viewerHeaders})).json();
  assert.equal(dispatchDetail.liters,'5.000000');
  const deliver=await request(distributionBase+'/records/'+dispatched.id,{method:'PATCH',headers:viewerHeaders,body:JSON.stringify({status:'delivered',revision:dispatchDetail.revision})});assert.equal(deliver.status,200);
  assert.equal((await (await request(processingBase+'/batches/'+mixedBatch.id,{headers})).json()).available_liters,'5.000000','Delivery must not deduct inventory twice');
  assert.equal((await request(distributionBase+'/records/'+dispatched.id,{method:'PATCH',headers:viewerHeaders,body:JSON.stringify({status:'cancelled',revision:dispatchDetail.revision})})).status,409,'Stale corrections are rejected');
  assert.equal((await (await request(distributionBase+'/records?customer='+customerOne.id,{headers:viewerHeaders})).json()).pagination.total,1);
  assert.equal((await (await request('/api/customers/'+customerOne.id+'/milk-distributions',{headers})).json()).pagination.total,1);
  assert.equal((await (await request('/api/milk-distribution/summary',{headers})).json()).totals.remaining_liters,'5.000000');
  assert.equal((await request('/api/operations/milk-operation-audit/distribution/'+dispatched.id,{headers:viewerHeaders})).status,200);
  const latestDistribution=await (await request('/api/milk-distribution/records/'+dispatched.id,{headers})).json();
  assert.equal(latestDistribution.status,'delivered','Admin sees the Operations status immediately');
  const flow=await (await request('/api/home?period=today',{headers})).json();
  assert.ok(Number(flow.operations.collected_liters)>=30,'Home includes actual received litres');
  assert.ok(Number(flow.operations.accepted_liters)>=20,'Home reads accepted litres from quality checks');
  assert.ok(Number(flow.operations.rejected_liters)>=10,'Home reads rejected litres separately');
  assert.ok(Number(flow.operations.processed_liters)>=10,'Home reads processed litres');
  assert.ok(Number(flow.operations.processed_liters)>=10,'Home reads processed output');
  assert.ok(Number(flow.operations.dispatched_liters)>=5,'Delivered dispatch is counted once');
  assert.ok(Number(flow.operations.customer_liters)>=5,'Customer destination split uses actual recipient type');
  assert.equal((await (await request('/api/home?period=today',{headers})).json()).network.distributors,1,'Home counts parent distributors only');
  assert.equal((await (await request('/api/operations/home?period=today',{headers:viewerHeaders})).json()).operations.dispatched_liters,flow.operations.dispatched_liters,'Both portals share the same reporting data');
  assert.equal((await request(distributionBase+'/records/'+dispatched.id,{method:'PATCH',headers:viewerHeaders,body:JSON.stringify({status:'cancelled',revision:latestDistribution.revision})})).status,409,'Delivered product cannot return to stock without a return workflow');
  const cancelResponse=await distribute(mixedBatch.id,2,'dispatched');assert.equal(cancelResponse.status,201);
  assert.equal((await request(distributionBase+'/records?sort=id',{headers:viewerHeaders})).status,200);
  assert.equal((await request(distributionBase+'/records?sort=bad',{headers:viewerHeaders})).status,400);
  const cancellation=await cancelResponse.json(),cancelDetail=await (await request(distributionBase+'/records/'+cancellation.id,{headers:viewerHeaders})).json();
  assert.equal((await (await request(processingBase+'/batches/'+mixedBatch.id,{headers})).json()).available_liters,'3.000000');
  assert.equal((await request(distributionBase+'/records/'+cancellation.id,{method:'PATCH',headers:viewerHeaders,body:JSON.stringify({status:'cancelled',revision:cancelDetail.revision})})).status,200);
  assert.equal((await (await request(processingBase+'/batches/'+mixedBatch.id,{headers})).json()).available_liters,'5.000000','Cancellation restores undistributed inventory');
  assert.equal((await (await request('/api/milk-distribution/records/'+cancellation.id,{headers})).json()).status,'cancelled');
  const competing=await Promise.all([distribute(mixedBatch.id,4,'dispatched'),distribute(mixedBatch.id,4,'dispatched')]);
  assert.deepEqual(competing.map(r=>r.status).sort(),[201,409],'Concurrent dispatches cannot overallocate inventory');
  assert.equal((await (await request(processingBase+'/batches/'+mixedBatch.id,{headers})).json()).available_liters,'1.000000');

  assert.equal((await request('/api/operations/farmers/'+farmer.id,{method:'PUT',headers:viewerHeaders,body:'{}'})).status,403);
  // Restore the older test fixture before its one-farmer assertions run.
  await testDb.query('DELETE FROM milk_operation_audit');
  await testDb.query('DELETE FROM milk_distributions');
  await testDb.query('DELETE FROM distributor_audit');
  await testDb.query('DELETE FROM distributors WHERE id=$1',[testStore.id]);
  await testDb.query('DELETE FROM distributors WHERE id=$1',[testParent.id]);
  await testDb.query('DELETE FROM milk_batch_allocations');
  await testDb.query('DELETE FROM milk_processing_batches');
  await testDb.query('DELETE FROM milk_quality_checks');
  await testDb.query('DELETE FROM milk_collection_photos WHERE collection_id=ANY($1::uuid[])',[[five.id,seven.id,ten.id,eight.id]]);
  await testDb.query('DELETE FROM milk_collections WHERE id=ANY($1::uuid[])',[[five.id,seven.id,ten.id,eight.id]]);
  const sourcePdf=await PDFDocument.create();for(let index=0;index<4;index++)sourcePdf.addPage([400,600]);const originalBytes=Buffer.from(await sourcePdf.save());
  const archiveUpload='/api/archives',firstDocs='/api/farmers/'+farmer.id+'/registration-documents',secondDocs='/api/farmers/'+secondFarmer.id+'/registration-documents';
  const uploadHeaders={...headers,'Content-Type':'application/pdf','Content-Length':String(originalBytes.length),'X-Archive-Batch-Id':'BATCH-TEST','X-Archive-Batch-Name':'Test registration archive','X-Archive-Expected-Count':'2','X-Archive-Filename':'original.pdf'};
  assert.equal((await request(archiveUpload,{method:'POST',headers:viewerHeaders,body:originalBytes})).status,401,'Viewer cannot upload an archive');
  assert.equal((await request(archiveUpload,{method:'POST',headers:elevatedHeaders,body:originalBytes})).status,401,'Elevated viewer cannot upload an archive');
  assert.equal((await request(archiveUpload,{method:'POST',headers:{...uploadHeaders,'Content-Type':'text/plain'},body:originalBytes})).status,415);
  assert.equal((await request(archiveUpload,{method:'POST',headers:uploadHeaders,body:originalBytes})).status,201);
  assert.equal((await request(archiveUpload,{method:'POST',headers:uploadHeaders,body:originalBytes})).status,409,'Duplicate batch ID or PDF must be rejected');
  const entriesPath='/api/archives/BATCH-TEST/entries';
  const firstEntryResponse=await request(entriesPath,{method:'POST',headers,body:JSON.stringify({farmer_id:farmer.id,page_start:1,page_end:2,verification_status:'matched'})});
  assert.equal(firstEntryResponse.status,201);const firstEntry=await firstEntryResponse.json();
  const secondEntryResponse=await request(entriesPath,{method:'POST',headers,body:JSON.stringify({farmer_id:secondFarmer.id,page_start:3,page_end:4,verification_status:'matched'})});
  assert.equal(secondEntryResponse.status,201);const secondEntry=await secondEntryResponse.json();
  assert.equal((await request(entriesPath,{method:'POST',headers,body:JSON.stringify({page_start:2,page_end:3})})).status,409,'Page overlap is forbidden');
  assert.equal((await (await request(firstDocs,{headers})).json()).length,1);
  const firstPdfPath=firstDocs+'/'+firstEntry.id+'/pdf',viewerFirstPdf='/api/operations/farmers/'+farmer.id+'/registration-documents/'+firstEntry.id+'/pdf';
  assert.equal((await request(firstPdfPath)).status,401);
  assert.equal((await request(firstPdfPath,{headers:viewerHeaders})).status,401);
  assert.equal((await request(firstDocs+'/'+secondEntry.id+'/pdf',{headers})).status,404,'A farmer URL cannot retrieve another farmer’s document');
  assert.equal((await request('/api/operations/farmers/'+farmer.id+'/registration-documents',{headers:viewerHeaders})).status,403);
  assert.equal((await request(viewerFirstPdf,{headers:viewerHeaders})).status,403);
  assert.equal((await request(viewerFirstPdf,{headers:elevatedHeaders})).status,200);
  assert.equal((await request(viewerFirstPdf+'?download=1',{headers:elevatedHeaders})).status,403);
  assert.equal((await request('/api/operations/farmers/'+secondFarmer.id+'/registration-documents/'+firstEntry.id+'/pdf',{headers:elevatedHeaders})).status,404);
  const isolatedResponse=await request(firstPdfPath,{headers});assert.equal(isolatedResponse.status,200);assert.equal(isolatedResponse.headers.get('x-frame-options'),'SAMEORIGIN');
  assert.equal((await PDFDocument.load(await isolatedResponse.arrayBuffer())).getPageCount(),2);
  assert.equal((await PDFDocument.load(await (await request('/api/archives/BATCH-TEST/original.pdf',{headers})).arrayBuffer())).getPageCount(),4);
  assert.equal((await request('/api/archives/BATCH-TEST/original.pdf',{headers:elevatedHeaders})).status,401);
  assert.equal((await (await request(secondDocs,{headers})).json()).length,1);
  assert.equal((await testDb.query("SELECT count(*)::int AS count FROM registration_archive_events WHERE batch_id='BATCH-TEST' AND action='view'")).rows[0].count,3);
  const revisedPdf=await PDFDocument.create();for(let index=0;index<5;index++)revisedPdf.addPage([400,600]);
  const revisedBytes=Buffer.from(await revisedPdf.save());
  await testDb.query(`INSERT INTO registration_archive_batches(id,name,original_filename,sha256,pdf_data,page_count,expected_farmer_count,uploaded_by,supersedes_batch_id)
   VALUES('BATCH-TEST-R2','Corrected test archive','updated.pdf',$1,$2,5,2,'administrator','BATCH-TEST')`,
   [createHash('sha256').update(revisedBytes).digest('hex'),revisedBytes]);
  await testDb.query(`INSERT INTO registration_archive_entries(batch_id,farmer_id,page_start,page_end,verification_status,isolated_pdf,isolated_sha256,associated_by)
   SELECT 'BATCH-TEST-R2',farmer_id,1,2,verification_status,isolated_pdf,isolated_sha256,'administrator'
   FROM registration_archive_entries WHERE id=$1`,[firstEntry.id]);
  const currentDocs=await (await request(firstDocs,{headers})).json();
  assert.equal(currentDocs.length,1,'Farmer profile shows only the current archive revision');
  assert.equal(currentDocs[0].batch_id,'BATCH-TEST-R2');
  assert.equal((await (await request('/api/archives',{headers})).json()).find(item=>item.id==='BATCH-TEST').superseded,true);
  assert.equal((await (await request('/api/operations/farmers/'+farmer.id+'/registration-documents',{headers:elevatedHeaders})).json()).length,1);
  // Keep the older directory suite's one-farmer fixture intact. This is an isolated test database.
  await testDb.query('DELETE FROM registration_archive_events WHERE entry_id=$1',[secondEntry.id]);
  await testDb.query('DELETE FROM registration_archive_entries WHERE id=$1',[secondEntry.id]);
  await testDb.query('DELETE FROM farmer_audit_events WHERE farmer_id=$1',[secondFarmer.id]);
  await testDb.query('DELETE FROM farmers WHERE id=$1',[secondFarmer.id]);
  const elevatedSession=await (await request('/api/operations/session',{headers:elevatedHeaders})).json();assert.equal(elevatedSession.sensitive_registration,true);
  assert.equal((await request('/api/operations/kra-verification',{headers:elevatedHeaders})).status,200);
  assert.equal((await (await request('/api/operations/session',{headers:viewerHeaders})).json()).sensitive_registration,false);
  const sensitiveResponse=await request(sensitivePath,{headers:elevatedHeaders});assert.equal(sensitiveResponse.status,200);
  const sensitive=await sensitiveResponse.json();
  assert.equal(sensitive.national_id,'PRIVATE-NATIONAL-ID');assert.equal(sensitive.kra_pin,'PRIVATE-KRA-PIN');
  assert.equal(sensitive.contacts[0].full_name,'PRIVATE NEXT OF KIN');assert.equal(sensitive.payments[0].mpesa_registered_name,'PRIVATE MPESA NAME');
  assert.equal(sensitive.consents[0].signed_name,'SIGNED TEST NAME');assert.equal(sensitive.verifications[0].verified_by,'TEST OFFICER');
  assert.equal(sensitive.sources[0].raw_transcription.farmer_signature,'SIGNATURE TRANSCRIPTION');
  assert(!JSON.stringify(sensitive).includes('before_record'),'Administrative audit data must not leak');
  assert.equal((await testDb.query('SELECT count(*)::int AS count FROM farmer_sensitive_access_events WHERE farmer_id=$1',[farmer.id])).rows[0].count,1,'Only the successful elevated read is audited');
  assert.equal((await request(sensitivePath,{method:'PUT',headers:elevatedHeaders,body:'{}'})).status,403);
  assert.equal((await request('/api/farmers/'+farmer.id,{headers:elevatedHeaders})).status,401);
  assert.equal((await request('/api/operations/logout',{method:'POST',headers:elevatedHeaders,body:'{}'})).status,200);
  assert.equal((await request(sensitivePath,{headers:elevatedHeaders})).status,401);
 }finally{await testDb.end();}
 const viewerPhoto=await request(viewerPhotoPath,{headers:viewerHeaders});assert.equal(viewerPhoto.status,200);assert.deepEqual(Buffer.from(await viewerPhoto.arrayBuffer()),replacementPhoto);
 assert.equal((await request(photoPath,{headers:viewerHeaders})).status,401);
 assert.equal((await request(viewerPhotoPath,{method:'PUT',headers:{...viewerHeaders,'Content-Type':'image/png'},body:firstPhoto})).status,403);
 assert.equal((await request(viewerPhotoPath,{method:'DELETE',headers:viewerHeaders})).status,403);
 for(const marker of ['PRIVATE-NATIONAL-ID','PRIVATE NEXT OF KIN','PRIVATE KIN PHONE','PRIVATE MPESA NAME','PRIVATE MPESA PHONE','TEST ADDRESS','TEST REVIEW ONLY','audit','payments','consents','verifications','raw_transcription'])assert(!JSON.stringify(viewerDetail).includes(marker),'Viewer leaked '+marker);
 for(const query of ['HOSTED UPDATED',farmer.customer_id,'TEST-PHONE-SEARCH','PRIVATE-KRA-PIN','TEST VILLAGE','TEST COUNTY','TEST LOCATION'])assert.equal((await (await request('/api/operations/farmers?'+new URLSearchParams({q:query}),{headers:viewerHeaders})).json()).stats.total,1,'Viewer search: '+query);
 for(const query of ['PRIVATE-NATIONAL-ID','TEST ADDRESS','pending_verification','TEST REVIEW ONLY'])assert.equal((await (await request('/api/operations/farmers?'+new URLSearchParams({q:query}),{headers:viewerHeaders})).json()).stats.total,0,'Viewer restricted search: '+query);
 const categoryList=await (await request('/api/operations/farmers?category=Satima%20Farmers&page_size=1&sort=full_name',{headers:viewerHeaders})).json();assert.equal(categoryList.stats.total,1);assert.equal(categoryList.pagination.page_size,1);
 assert.equal((await request('/api/operations/farmers?category=unassigned',{headers:viewerHeaders})).status,400);
 for(const [route,method] of [['/api/farmers','POST'],['/api/farmers/'+farmer.id,'PUT'],['/api/farmers/'+farmer.id+'/issues','POST'],['/api/operations/farmers','POST'],['/api/operations/farmers/'+farmer.id,'PUT'],['/api/operations/farmers/'+farmer.id,'DELETE'],['/api/operations/farmers/'+farmer.id,'PATCH']]){
  const response=await request(route,{method,headers:viewerHeaders});assert([401,403].includes(response.status),method+' '+route);
 }
 assert.equal((await request('/api/farmers',{headers})).status,200,'Viewer activity must not revoke administrator session');
 const owner=new pg.Client({connectionString:`postgresql://satima_admin:${secret}@127.0.0.1:${port}/satima_cms`});await owner.connect();
 try{
  const source='f'.repeat(64);
  for(const row of [15,21])await owner.query(`INSERT INTO farmer_master_sources(document_sha256,document_name,sheet_name,row_number,source_name,source_category,match_result)
    VALUES($1,'test.xlsx','Table 1',$2,$3,'Satima Farmers','review_required')`,[source,row,'TEST FLAG '+row]);
  const {rows:[another]}=await owner.query("INSERT INTO farmers(full_name,primary_phone,registered_by) VALUES('FLAG TEST CANDIDATE','TEST-FLAG-PHONE','TEST') RETURNING id");
  const ids=[];
  for(const [row,id] of [[15,farmer.id],[21,farmer.id],[21,another.id]]){
   const issue=await owner.query("INSERT INTO farmer_data_issues(farmer_id,field_name,description) VALUES($1,'master_supplier_match',$2) RETURNING id",[id,'Supplier master row '+row+': Confirm identity.']);ids.push(issue.rows[0].id);
  }
  const adminFlags=await (await request('/api/flagged-records',{headers})).json();
  assert.equal((await request('/api/operations/flagged-records',{headers:viewerHeaders})).status,404);
  assert.equal(adminFlags.total,2);
  assert.equal(adminFlags.records.find(r=>r.row_number===21).candidates.length,2,'Two possible farmers still count as one flagged source record');
  assert.equal((await request('/api/operations/flagged-records',{method:'POST',headers:viewerHeaders,body:'{}'})).status,403);
  await owner.query("UPDATE farmer_data_issues SET status='resolved',resolution_note='Test review',resolved_at=now() WHERE id=$1",[ids[1]]);
  assert.equal((await (await request('/api/flagged-records',{headers})).json()).total,2);
  await owner.query("UPDATE farmer_data_issues SET status='resolved',resolution_note='Test review',resolved_at=now() WHERE id=$1",[ids[2]]);
  assert.equal((await (await request('/api/flagged-records',{headers})).json()).total,1);
  await owner.query("UPDATE farmer_data_issues SET status='resolved',resolution_note='Test review',resolved_at=now() WHERE id=$1",[ids[0]]);
  await owner.query('DELETE FROM farmer_data_issues WHERE farmer_id=$1',[another.id]);
  await owner.query('DELETE FROM farmer_audit_events WHERE farmer_id=$1',[another.id]);
  await owner.query('DELETE FROM farmers WHERE id=$1',[another.id]);
  const {rows:[reviewSource]}=await owner.query(`INSERT INTO farmer_master_sources(document_sha256,document_name,sheet_name,row_number,source_name,source_phone,source_category,match_result)
   VALUES($1,'test.xlsx','Table 1',31,'HOSTED UPDATED','TEST-REVIEW-PHONE','Satima Farmers','review_required') RETURNING id`,[source]);
  await owner.query("INSERT INTO farmer_data_issues(farmer_id,field_name,description) VALUES($1,'master_supplier_match','Supplier master row 31: Confirm identity.')",[farmer.id]);
  assert.equal((await request('/api/operations/flagged-records/'+reviewSource.id,{headers:viewerHeaders})).status,404);
  const reviewDetail=await request('/api/flagged-records/'+reviewSource.id,{headers});assert.equal(reviewDetail.status,200);
  const candidateRevision=(await reviewDetail.json()).candidates.find(candidate=>candidate.id===farmer.id).revision;
  assert.equal((await request('/api/flagged-records/'+reviewSource.id,{method:'POST',headers,body:JSON.stringify({decision:'defer',note:'Awaiting source confirmation.'})})).status,200);
  assert.equal((await request('/api/flagged-records/'+reviewSource.id,{method:'POST',headers,body:JSON.stringify({decision:'match',farmer_id:farmer.id,expected_revision:candidateRevision,approved_fields:['category'],note:'Confirmed against registration.'})})).status,200);
  assert.equal((await request('/api/flagged-records/'+reviewSource.id,{method:'POST',headers,body:JSON.stringify({decision:'match',farmer_id:farmer.id})})).status,409,'A resolved source cannot be matched twice');
  assert.equal((await (await request('/api/flagged-records',{headers})).json()).total,0);
  const {rows:[newSource]}=await owner.query(`INSERT INTO farmer_master_sources(document_sha256,document_name,sheet_name,row_number,source_name,source_category,match_result)
   VALUES($1,'test.xlsx','Table 1',32,'TEST PROVISIONAL SUPPLIER','Others','review_required') RETURNING id`,[source]);
  const createdReview=await request('/api/flagged-records/'+newSource.id,{method:'POST',headers,body:JSON.stringify({decision:'create',note:'No existing match found.'})});
  assert.equal(createdReview.status,200);const createdFarmer=(await createdReview.json()).farmer_id;
  assert.equal((await owner.query('SELECT registration_status FROM farmers WHERE id=$1',[createdFarmer])).rows[0].registration_status,'not_registered');
  assert.equal((await request('/api/flagged-records/'+newSource.id,{method:'POST',headers,body:JSON.stringify({decision:'create'})})).status,409);
  await owner.query('DELETE FROM farmer_master_reviews WHERE source_id=$1',[newSource.id]);
  await owner.query('DELETE FROM farmer_master_sources WHERE id=$1',[newSource.id]);
  await owner.query('DELETE FROM farmer_audit_events WHERE farmer_id=$1',[createdFarmer]);
  await owner.query('DELETE FROM farmers WHERE id=$1',[createdFarmer]);
 }finally{await owner.end();}
 assert.equal((await request('/api/operations/logout',{method:'POST',headers:viewerHeaders,body:'{}'})).status,200);
 assert.equal((await request('/api/operations/farmers',{headers:viewerHeaders})).status,401);
 assert.equal((await request(viewerPhotoPath,{headers:viewerHeaders})).status,401);
 assert.equal((await (await request('/api/farmers?q=no-matching-column-value',{headers})).json()).stats.total,0);
 const beforeKraEdit=await (await request('/api/farmers/'+farmer.id,{headers})).json();
 assert.equal((await request('/api/farmers/'+farmer.id,{method:'PUT',headers,body:JSON.stringify({...beforeKraEdit,kra_pin:' p123456789a '})})).status,200);
 assert.equal((await (await request('/api/farmers?q=P123456789A',{headers})).json()).stats.total,1,'Admin directory searches PINs');
 const kraCheck={outcome:'verified',taxpayer_name:'HOSTED UPDATED',pin_status:'Active',checked_at:'2026-10-12',checked_by:'TEST ACCOUNTANT',remarks:'Checked official site',expected_pin:'P123456789A',expected_revision:null};
 assert.equal((await request(kraPath,{method:'POST',headers,body:JSON.stringify(kraCheck)})).status,201);
 const checkedKra=await (await request('/api/kra-verification',{headers})).json();assert.equal(checkedKra.stats.verified,1);assert.equal(checkedKra.records[0].name_match,'exact');
 const adminVerified=await (await request('/api/kra-verification?bucket=verified',{headers})).json();assert.equal(adminVerified.pagination.total,1);assert.equal(adminVerified.records[0].id,farmer.id);
 assert.equal((await (await request('/api/kra-verification?bucket=pending',{headers})).json()).pagination.total,0);
 assert.equal((await request('/api/kra-verification?bucket=unknown',{headers})).status,400);
 assert.equal((await (await request(kraPath,{headers})).json()).history.length,1);
 // Both portal sessions read the same result; only the KRA POST is a viewer write exception.
 const viewerRelogin=await request('/api/operations/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({username:'operations',password:viewerSecret})});
 assert.equal(viewerRelogin.status,200);const kraViewerHeaders={Origin:'https://satima.example','Content-Type':'application/json',Cookie:viewerRelogin.headers.get('set-cookie').split(';')[0]};
 const viewerKraPath='/api/operations/kra-verification/'+farmer.id;
 assert.equal((await (await request('/api/operations/kra-verification',{headers:kraViewerHeaders})).json()).stats.verified,1);
 assert.equal((await (await request('/api/operations/kra-verification?bucket=verified',{headers:kraViewerHeaders})).json()).pagination.total,adminVerified.pagination.total);
 const seenByViewer=await (await request(viewerKraPath,{headers:kraViewerHeaders})).json();assert.equal(seenByViewer.history[0].source_portal,'Admin');
 const operationsCheck={...kraCheck,outcome:'needs_review',remarks:'Test review',expected_revision:seenByViewer.revision};
 assert.equal((await request(viewerKraPath,{method:'POST',headers:kraViewerHeaders,body:JSON.stringify(operationsCheck)})).status,201);
 const seenByAdmin=await (await request(kraPath,{headers})).json();assert.equal(seenByAdmin.history[0].outcome,'needs_review');assert.equal(seenByAdmin.history[0].source_portal,'Operations');assert.equal(seenByAdmin.history.length,2);
 assert.equal((await (await request('/api/kra-verification?bucket=review',{headers})).json()).pagination.total,1);
 assert.equal((await (await request('/api/operations/kra-verification?bucket=review',{headers:kraViewerHeaders})).json()).pagination.total,1);
 assert.equal((await request(kraPath,{method:'POST',headers,body:JSON.stringify({...kraCheck,expected_revision:seenByViewer.revision})})).status,409,'Stale Admin review must not replace Operations outcome');
 assert.equal((await request(viewerKraPath,{method:'POST',headers:kraViewerHeaders,body:JSON.stringify({...operationsCheck,expected_pin:'P000000000A',expected_revision:seenByAdmin.revision})})).status,409,'Stale PIN must not be used');
 assert.equal((await request('/api/operations/farmers/'+farmer.id,{method:'PUT',headers:kraViewerHeaders,body:'{}'})).status,403);
 assert.equal((await request('/api/operations/logout',{method:'POST',headers:kraViewerHeaders,body:'{}'})).status,200);
 assert.equal((await request(viewerKraPath,{headers:kraViewerHeaders})).status,401);
 assert.equal((await request('/api/farmers?scope=demo&q=TEST%20COUNTY',{headers})).status,400);
 const rotated=await request('/api/login',{method:'POST',headers,body:JSON.stringify({username:'admin',password:cmsSecret})});assert.equal(rotated.status,200);
 assert.equal((await request('/api/farmers',{headers})).status,401,'Previous login session must be revoked');
 headers.Cookie=rotated.headers.get('set-cookie').split(';')[0];
 const invalidPage=await request('/api/farmers?page=0',{headers});assert.equal(invalidPage.status,400);
 const paged=await (await request('/api/farmers?page_size=1&sort=customer_id&review=open',{headers})).json();assert.equal(paged.pagination.page_size,1);assert.equal(paged.stats.total,1);
 const logout=await request('/api/logout',{method:'POST',headers,body:'{}'});assert.match(logout.headers.get('set-cookie'),/; Secure/);
 assert.equal((await request('/api/farmers',{headers})).status,401);
 const restricted=new pg.Client({connectionString:`postgresql://satima_app:${appSecret}@127.0.0.1:${port}/satima_cms`});await restricted.connect();
 try{
  assert.equal((await restricted.query('SELECT full_name FROM farmers WHERE id=$1',[farmer.id])).rows[0].full_name,'HOSTED UPDATED');
  const persisted=await restricted.query('SELECT image_data FROM farmer_photographs WHERE farmer_id=$1',[farmer.id]);assert.deepEqual(persisted.rows[0].image_data,replacementPhoto,'Photograph persists in PostgreSQL after requests');
  await assert.rejects(restricted.query('DELETE FROM farmers'),e=>e.code==='42501');
  await assert.rejects(restricted.query("UPDATE farmer_audit_events SET actor='forged'"),e=>e.code==='42501');
 }finally{await restricted.end();}
 const removeLogin=await request('/api/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:cmsSecret})});assert.equal(removeLogin.status,200);
 const removeHeaders={Origin:'https://satima.example',Cookie:removeLogin.headers.get('set-cookie').split(';')[0]};
 const laterDevice=removeLogin.headers.get('set-cookie').match(/satima_draft_device=[a-f0-9]{64}/)?.[0];
 const laterDraftHeaders={...removeHeaders,Cookie:removeHeaders.Cookie+'; '+laterDevice,'Content-Type':'application/json'};
 assert.equal((await request('/api/drafts/farmer-registration',{method:'PUT',headers:laterDraftHeaders,body:JSON.stringify({content:{full_name:'Cross-process draft'}})})).status,200);
 // Run the complete suite against the disposable database and a local-mode server.
 phase='separate process persistence';
 const localEnv={...env,RENDER:'false',PORT:'31988',CMS_PORT:'31988',TEST_ISOLATED_DATABASE:'1'};delete localEnv.PUBLIC_ORIGIN;
 localServer=spawn(process.execPath,['app/server.mjs'],{env:localEnv,stdio:['ignore','pipe','pipe']});
 for(let n=0;n<80;n++){try{if((await fetch('http://127.0.0.1:31988/health')).status===200)break;}catch{}await delay(100);}
 const localBase='http://127.0.0.1:31988';
 const localLogin=await fetch(localBase+'/api/login',{method:'POST',headers:{Origin:localBase,'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:cmsSecret})});assert.equal(localLogin.status,200);
 const localHeaders={Origin:localBase,Cookie:localLogin.headers.get('set-cookie').split(';')[0]};
 assert.equal((await fetch(localBase+'/api/session',{headers:{Cookie:removeHeaders.Cookie}})).status,200,'A separate app process accepts the persistent session');
 assert.equal((await (await fetch(localBase+'/api/drafts/farmer-registration',{headers:{Cookie:laterDraftHeaders.Cookie}})).json()).content.full_name,'Cross-process draft','A separate app process restores the draft');
 const afterRestart=await fetch(localBase+photoPath,{headers:localHeaders});assert.equal(afterRestart.status,200);assert.deepEqual(Buffer.from(await afterRestart.arrayBuffer()),replacementPhoto,'New app process reads the persisted photograph');
 assert.equal((await fetch(localBase+photoPath,{method:'DELETE',headers:localHeaders})).status,200);
 assert.equal((await request(photoPath,{headers:removeHeaders})).status,404);
 assert.equal((await (await request('/api/farmers/'+farmer.id,{headers:removeHeaders})).json()).has_photograph,false);
 assert.equal((await request('/api/logout',{method:'POST',headers:laterDraftHeaders,body:'{}'})).status,200);
 assert.equal((await request('/api/session',{headers:removeHeaders})).status,401,'Explicit logout revokes the persistent session');
 const expiredLogin=await request('/api/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:cmsSecret})});
 const expiredCookie=expiredLogin.headers.get('set-cookie').split(';')[0];
 const expiryOwner=new pg.Client({connectionString:`postgresql://satima_admin:${secret}@127.0.0.1:${port}/satima_cms`});await expiryOwner.connect();
 try{
  await expiryOwner.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[createHash('sha256').update(expiredCookie.split('=')[1]).digest('hex')]);
  const deviceHash=createHash('sha256').update(laterDevice.split('=')[1]).digest('hex');
  assert.equal((await expiryOwner.query('SELECT count(*)::int AS n FROM form_drafts WHERE device_hash=$1',[deviceHash])).rows[0].n,0,'Logout clears private drafts on this device');
 }finally{await expiryOwner.end();}
 assert.equal((await request('/api/session',{headers:{Cookie:expiredCookie}})).status,401,'Expired persistent sessions are rejected');
 const suite=spawnSync(process.execPath,['--test','app/tests/hosting.test.mjs','app/tests/registration.test.mjs','app/tests/directory.test.mjs','app/tests/security.test.mjs','app/tests/kra-verification.test.mjs','app/tests/milk-ui.test.mjs','app/tests/milk-operations-ui.test.mjs','app/tests/master-sync.test.mjs','app/tests/home-support.test.mjs','app/tests/dates.test.mjs'],{env:localEnv,encoding:'utf8'});assert.equal(suite.status,0,suite.stdout+suite.stderr);console.log(suite.stdout);
 phase='automatic pooled allocation';
 const poolLogin=await request('/api/operations/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({username:'operations',password:viewerSecret})});
 const poolHeaders={Origin:'https://satima.example','Content-Type':'application/json',Cookie:poolLogin.headers.get('set-cookie').split(';')[0]};
 const poolCollection=async(amount,farmerId)=>{const response=await request('/api/operations/milk-collections',{method:'POST',headers:{...milkHeaders(poolHeaders,amount,randomUUID()),'X-Farmer-Id':farmerId},body:milkImage});assert.equal(response.status,201);return response.json();};
 const pooledThree=await poolCollection('3',farmer.id),pooledSeven=await poolCollection('7',farmer.id);
 for(const [collection,amount] of [[pooledThree,'3'],[pooledSeven,'7']])assert.equal((await request('/api/operations/milk-processing/quality',{method:'POST',headers:poolHeaders,body:JSON.stringify({collection_id:collection.id,accepted_liters:amount,rejected_liters:'0',inspected_on:milkDay,inspected_by:'Test Inspector',idempotency_key:randomUUID()})})).status,201);
 const autoBatch=(input,key=randomUUID())=>request('/api/operations/milk-processing/batches',{method:'POST',headers:poolHeaders,body:JSON.stringify({processed_on:milkDay,input_liters:input,processed_liters:'2',product_format:'Fresh milk',operator_name:'Test Processor',idempotency_key:key})});
 const autoKey=randomUUID(),autoResponse=await autoBatch('6',autoKey);assert.equal(autoResponse.status,201,autoResponse.status===201?'':await autoResponse.text());const autoSaved=await autoResponse.json();
 assert.equal((await autoBatch('6',autoKey)).status,200,'Automatic batch submission is idempotent');
 const autoDetail=await (await request('/api/operations/milk-processing/batches/'+autoSaved.id,{headers:poolHeaders})).json();
 assert.equal(autoDetail.input_liters,'6.000000');assert.equal(autoDetail.allocations.length,2);assert.equal(autoDetail.allocations[0].collection_id,pooledThree.id,'Oldest unallocated accepted collection is selected');
 assert.equal((await autoBatch('5')).status,409,'Accepted pool cannot be overspent');
 const concurrent=await Promise.all([autoBatch('3'),autoBatch('3')]);assert.deepEqual(concurrent.map(response=>response.status).sort(),[201,409],'Concurrent batches cannot allocate the same accepted milk');
 phase='private directory synchronization';
 const privateDir=await mkdtemp(join(tmpdir(),'satima-sync-test-'));
 try{
  const file=join(privateDir,'customers.csv'),plan=join(privateDir,'preview.json');
  await writeFile(file,'full_name,phone_number,physical_address,category\nFixture Customer,0712345679,Fixture Place,Current Customers\n');
  const syncEnv={...env,ADMIN_DATABASE_URL:`postgresql://satima_admin:${secret}@127.0.0.1:${port}/satima_cms`};
  const sync=mode=>spawnSync(process.execPath,['app/scripts/sync-master.mjs',mode,'customers',file,plan],{env:syncEnv,encoding:'utf8'});
  const preview=sync('preview');assert.equal(preview.status,0,preview.stderr);assert.equal(JSON.parse(preview.stdout).added,1);
  const applied=sync('apply');assert.equal(applied.status,0,applied.stderr);assert.equal(JSON.parse(applied.stdout).added,1);
  const repeated=sync('apply');assert.equal(repeated.status,0,repeated.stderr);assert.match(repeated.stdout,/already synchronized/);
  const owner=new pg.Client({connectionString:syncEnv.ADMIN_DATABASE_URL});await owner.connect();
  try{const {rows:[linked]}=await owner.query(`SELECT count(*)::int AS n FROM customers WHERE full_name='Fixture Customer'`);assert.equal(linked.n,1);}finally{await owner.end();}
 }finally{await rm(privateDir,{recursive:true,force:true});}

 console.log('PASS: fresh migrations, repeat migrations, non-superuser owner, HTTPS origin, Secure cookies, login, register, edit, search, logout, SQL persistence and restricted-role protections.');
}catch(error){console.error('Hosted test phase:',phase,'server running:',server?.exitCode===null,'server error:',serverLog.replaceAll(secret,'[redacted]').replaceAll(appSecret,'[redacted]').slice(-1800)||'none');throw error;}finally{
 if(localServer){localServer.kill('SIGTERM');await new Promise(resolve=>localServer.once('exit',resolve));}
 if(server){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
 if(db)await db.end();
 spawnSync(docker,['rm','-f','-v',name],{stdio:'ignore'});
}

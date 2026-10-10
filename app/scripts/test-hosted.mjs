// Uses a disposable PostgreSQL container; never connects to the local CMS database.
import {spawnSync,spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {hashViewerPassword} from '../security.mjs';
const docker=process.env.DOCKER||'/Applications/Docker.app/Contents/Resources/bin/docker';
const name='satima-hosting-test-'+randomBytes(4).toString('hex');
const secret=randomBytes(24).toString('hex'),appSecret=randomBytes(24).toString('hex'),cmsSecret=randomBytes(24).toString('hex'),viewerSecret=randomBytes(32).toString('hex');
let server,localServer,db;
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
 const env={...process.env,ADMIN_DATABASE_URL:`postgresql://satima_admin:${secret}@127.0.0.1:${port}/satima_cms`,APP_DB_PASSWORD:appSecret,CMS_PASSWORD:cmsSecret,VIEWER_USERNAME:'operations-viewer',VIEWER_PASSWORD_HASH:await hashViewerPassword(viewerSecret),PORT:'31987',PUBLIC_ORIGIN:'https://satima.example',RENDER:'true'};
 migration(env);migration(env);
 env.DATABASE_URL=`postgresql://satima_app:${appSecret}@127.0.0.1:${port}/satima_cms`;
 delete env.ADMIN_DATABASE_URL;delete env.APP_DB_PASSWORD;
 server=spawn(process.execPath,['app/scripts/start-hosted.mjs'],{env,stdio:['ignore','pipe','pipe']});
 for(let n=0;n<80;n++){try{if((await fetch('http://127.0.0.1:31987/health')).status===200)break;}catch{}await delay(100);}
 const request=(path,options={})=>new Promise((resolve,reject)=>{
  const r=http.request('http://127.0.0.1:31987'+path,{method:options.method||'GET',headers:{Host:'satima.example',...options.headers}},res=>{let data='';res.on('data',b=>data+=b);res.on('end',()=>resolve(new Response(data,{status:res.statusCode,headers:res.headers})));});
  r.on('error',reject);r.end(options.body);
 });
 for(const route of ['/farmers/category/satima','/farmers/category/larger-sagana','/farmers/category/kangema','/farmers/category/others','/farmers/awaiting-categorization']){
const response=await request(route);assert.equal(response.status,200,route);assert.match(response.headers.get('content-type'),/text\/html/);assert.match(await response.text(),/id="directory"/);
 }
 for(const route of ['/operations','/operations/login','/operations/customers','/operations/distributors','/operations/category/satima','/operations/category/larger-sagana','/operations/category/kangema','/operations/category/others']){
const response=await request(route);assert.equal(response.status,200,route);assert.match(await response.text(),/Morning Dew Operations Portal/);
 }
assert.equal((await request('/api/farmers')).status,401);
assert.equal((await fetch('http://127.0.0.1:31987/')).status,403);
assert.equal((await request('/api/login',{method:'POST',headers:{Origin:'http://satima.example'},body:'{}'})).status,403);
const login=await request('/api/login',{method:'POST',headers:{Origin:'https://satima.example'},body:JSON.stringify({password:cmsSecret})});
assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/; Secure/);
 const headers={Origin:'https://satima.example',Cookie:login.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
const created=await request('/api/farmers',{method:'POST',headers,body:JSON.stringify({full_name:'HOSTED TEST ONLY',primary_phone:'TEST-PHONE-SEARCH',registered_by:'TEST',village_area:'TEST VILLAGE',county:'TEST COUNTY',location:'TEST LOCATION',sub_location:'TEST SUBLOCATION',sub_county:'TEST SUBCOUNTY',physical_address:'TEST ADDRESS',national_id:'PRIVATE-NATIONAL-ID',kra_pin:'PRIVATE-KRA-PIN',category:'Satima Farmers',contact:{full_name:'PRIVATE NEXT OF KIN',phone_number:'PRIVATE KIN PHONE',relationship:'TEST'},payment:{mpesa_registered_name:'PRIVATE MPESA NAME',mpesa_phone_number:'PRIVATE MPESA PHONE'}})});
assert.equal(created.status,201);const farmer=await created.json();
let detail=await (await request('/api/farmers/'+farmer.id,{headers})).json();
 assert.equal((await request('/api/farmers/'+farmer.id,{method:'PUT',headers,body:JSON.stringify({...detail,full_name:'HOSTED UPDATED'})})).status,200);
 const results=await (await request('/api/farmers?q=HOSTED%20UPDATED',{headers})).json();assert.equal(results.stats.total,1);
 detail=await (await request('/api/farmers/'+farmer.id,{headers})).json();
 const blocked=await request('/api/farmers/'+farmer.id,{method:'PUT',headers,body:JSON.stringify({...detail,status:'active'})});assert.equal(blocked.status,400);assert.match((await blocked.json()).error,/Active status requires/);
 assert.equal((await (await request('/api/farmers/'+farmer.id,{headers})).json()).status,'pending_verification');
 for(const query of ['HOSTED UPDATED',farmer.customer_id,'TEST-PHONE-SEARCH','TEST VILLAGE','TEST COUNTY','TEST LOCATION','TEST SUBLOCATION','TEST SUBCOUNTY','TEST ADDRESS','Pending verification','pending_verification','No open notes']){
  const response=await request('/api/farmers?'+new URLSearchParams({q:query}),{headers});assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.stats.total,1,'Search: '+query);assert.equal(data.farmers[0].id,farmer.id);
 }
 const note=await request('/api/farmers/'+farmer.id+'/issues',{method:'POST',headers,body:JSON.stringify({field_name:'location',description:'TEST REVIEW ONLY'})});assert.equal(note.status,201);
 const reviewed=await (await request('/api/farmers?q=1%20open',{headers})).json();assert.equal(reviewed.stats.total,1);assert.equal(reviewed.farmers[0].open_issues,1);
 assert.equal((await request('/api/operations/farmers')).status,401);
 assert.equal((await request('/api/operations/farmers',{headers})).status,401,'Administrator cookie is not a viewer session');
 assert.equal((await request('/api/operations/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({username:'wrong',password:viewerSecret})})).status,401);
 const viewerLogin=await request('/api/operations/login',{method:'POST',headers:{Origin:'https://satima.example','Content-Type':'application/json'},body:JSON.stringify({username:'operations-viewer',password:viewerSecret})});
 assert.equal(viewerLogin.status,200);assert.match(viewerLogin.headers.get('set-cookie'),/HttpOnly.*SameSite=Strict.*Secure/);
 const viewerHeaders={Origin:'https://satima.example',Cookie:viewerLogin.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 assert.equal((await request('/api/operations/session',{headers:viewerHeaders})).status,200);
 assert.equal((await request('/api/session',{headers:viewerHeaders})).status,401);
 const viewerList=await (await request('/api/operations/farmers',{headers:viewerHeaders})).json();
 assert.equal(viewerList.stats.total,1);assert.equal(viewerList.farmers[0].customer_id,farmer.customer_id);
 assert.deepEqual(Object.keys(viewerList.farmers[0]).sort(),['category','county','customer_id','full_name','id','location','primary_phone','registration_date','registration_status','village_area'].sort());
 const viewerDetail=await (await request('/api/operations/farmers/'+farmer.id,{headers:viewerHeaders})).json();
 for(const marker of ['PRIVATE-NATIONAL-ID','PRIVATE-KRA-PIN','PRIVATE NEXT OF KIN','PRIVATE KIN PHONE','PRIVATE MPESA NAME','PRIVATE MPESA PHONE','TEST ADDRESS','TEST REVIEW ONLY','audit','payments','consents','verifications','raw_transcription'])assert(!JSON.stringify(viewerDetail).includes(marker),'Viewer leaked '+marker);
 for(const query of ['HOSTED UPDATED',farmer.customer_id,'TEST-PHONE-SEARCH','TEST VILLAGE','TEST COUNTY','TEST LOCATION'])assert.equal((await (await request('/api/operations/farmers?'+new URLSearchParams({q:query}),{headers:viewerHeaders})).json()).stats.total,1,'Viewer search: '+query);
 for(const query of ['PRIVATE-NATIONAL-ID','PRIVATE-KRA-PIN','TEST ADDRESS','pending_verification','TEST REVIEW ONLY'])assert.equal((await (await request('/api/operations/farmers?'+new URLSearchParams({q:query}),{headers:viewerHeaders})).json()).stats.total,0,'Viewer restricted search: '+query);
 const categoryList=await (await request('/api/operations/farmers?category=Satima%20Farmers&page_size=1&sort=full_name',{headers:viewerHeaders})).json();assert.equal(categoryList.stats.total,1);assert.equal(categoryList.pagination.page_size,1);
 assert.equal((await request('/api/operations/farmers?category=unassigned',{headers:viewerHeaders})).status,400);
 for(const [route,method] of [['/api/farmers','POST'],['/api/farmers/'+farmer.id,'PUT'],['/api/farmers/'+farmer.id+'/issues','POST'],['/api/operations/farmers','POST'],['/api/operations/farmers/'+farmer.id,'PUT'],['/api/operations/farmers/'+farmer.id,'DELETE'],['/api/operations/farmers/'+farmer.id,'PATCH']]){
  const response=await request(route,{method,headers:viewerHeaders});assert([401,403].includes(response.status),method+' '+route);
 }
 assert.equal((await request('/api/farmers',{headers})).status,200,'Viewer activity must not revoke administrator session');
 assert.equal((await request('/api/operations/logout',{method:'POST',headers:viewerHeaders,body:'{}'})).status,200);
 assert.equal((await request('/api/operations/farmers',{headers:viewerHeaders})).status,401);
 assert.equal((await (await request('/api/farmers?q=no-matching-column-value',{headers})).json()).stats.total,0);
 assert.equal((await request('/api/farmers?scope=demo&q=TEST%20COUNTY',{headers})).status,400);
 const rotated=await request('/api/login',{method:'POST',headers,body:JSON.stringify({password:cmsSecret})});assert.equal(rotated.status,200);
 assert.equal((await request('/api/farmers',{headers})).status,401,'Previous login session must be revoked');
 headers.Cookie=rotated.headers.get('set-cookie').split(';')[0];
 const invalidPage=await request('/api/farmers?page=0',{headers});assert.equal(invalidPage.status,400);
 const paged=await (await request('/api/farmers?page_size=1&sort=customer_id&review=open',{headers})).json();assert.equal(paged.pagination.page_size,1);assert.equal(paged.stats.total,1);
 const logout=await request('/api/logout',{method:'POST',headers,body:'{}'});assert.match(logout.headers.get('set-cookie'),/; Secure/);
 assert.equal((await request('/api/farmers',{headers})).status,401);
 const restricted=new pg.Client({connectionString:`postgresql://satima_app:${appSecret}@127.0.0.1:${port}/satima_cms`});await restricted.connect();
 try{
  assert.equal((await restricted.query('SELECT full_name FROM farmers')).rows[0].full_name,'HOSTED UPDATED');
  await assert.rejects(restricted.query('DELETE FROM farmers'),e=>e.code==='42501');
  await assert.rejects(restricted.query("UPDATE farmer_audit_events SET actor='forged'"),e=>e.code==='42501');
 }finally{await restricted.end();}
 // Run the complete suite against the disposable database and a local-mode server.
 const localEnv={...env,RENDER:'false',PORT:'31988',CMS_PORT:'31988',TEST_ISOLATED_DATABASE:'1'};delete localEnv.PUBLIC_ORIGIN;
 localServer=spawn(process.execPath,['app/server.mjs'],{env:localEnv,stdio:['ignore','pipe','pipe']});
 for(let n=0;n<80;n++){try{if((await fetch('http://127.0.0.1:31988/health')).status===200)break;}catch{}await delay(100);}
 const suite=spawnSync(process.execPath,['--test','app/tests/hosting.test.mjs','app/tests/registration.test.mjs','app/tests/directory.test.mjs','app/tests/security.test.mjs'],{env:localEnv,encoding:'utf8'});assert.equal(suite.status,0,suite.stdout+suite.stderr);console.log(suite.stdout);
 console.log('PASS: fresh migrations, repeat migrations, non-superuser owner, HTTPS origin, Secure cookies, login, register, edit, search, logout, SQL persistence and restricted-role protections.');
}finally{
 if(localServer){localServer.kill('SIGTERM');await new Promise(resolve=>localServer.once('exit',resolve));}
 if(server){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
 if(db)await db.end();
 spawnSync(docker,['rm','-f','-v',name],{stdio:'ignore'});
}

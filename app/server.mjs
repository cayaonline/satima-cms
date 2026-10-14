import {SessionStore,LoginLimiter,validViewerHash,verifyViewerPassword} from './security.mjs';
import {listFarmers} from './directory.mjs';
import {listKra,kraHistory,recordKraCheck} from './kra-verification.mjs';
import {listOperationsFarmers,operationsFarmerDetail,operationsFarmerRegistrationDetail} from './operations-directory.mjs';
import {listFlaggedSuppliers} from './flagged-suppliers.mjs';
import {listCustomers,customerDetail,customerCategoryRoutes} from './customers.mjs';
import {milkSubmission,saveMilkCollection,searchMilkFarmers,listMilkCollections,milkSummary,milkDetail,milkPhoto,farmerMilkHistory} from './milk-collection.mjs';
import http from 'node:http';
import {requestPolicy} from './hosting.mjs';
import {createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pool,Problem,text,transaction,createFarmer,updateFarmer,detail} from './store.mjs';
import {photographBody,readPhotograph,savePhotograph,removePhotograph} from './photographs.mjs';
import {readPdfBody,batchMetadata,createArchiveBatch,listArchiveBatches,listArchiveEntries,saveArchiveEntry,farmerArchiveDocuments,protectedPdf} from './registration-archive.mjs';
if(!process.env.CMS_PASSWORD||process.env.CMS_PASSWORD.length<9)throw new Error('CMS_PASSWORD must be at least 9 characters.');
const ttl=8*3600*1000,sessions=new SessionStore({ttl}),attempts=new LoginLimiter();
const viewerSessions=new SessionStore({ttl}),viewerAttempts=new LoginLimiter();
const viewerUsername=process.env.VIEWER_USERNAME,viewerPasswordHash=process.env.VIEWER_PASSWORD_HASH;
if((viewerUsername||viewerPasswordHash)&&(!/^[A-Za-z0-9._-]{3,64}$/.test(viewerUsername||'')||!validViewerHash(viewerPasswordHash)))throw new Error('Viewer credentials must be configured together with a valid scrypt hash.');
const viewerEnabled=!!(viewerUsername&&viewerPasswordHash);
const registrationViewerUsername=process.env.REGISTRATION_VIEWER_USERNAME,registrationViewerPasswordHash=process.env.REGISTRATION_VIEWER_PASSWORD_HASH;
if((registrationViewerUsername||registrationViewerPasswordHash)&&(!/^[A-Za-z0-9._-]{3,64}$/.test(registrationViewerUsername||'')||!validViewerHash(registrationViewerPasswordHash)))throw new Error('Elevated viewer credentials must be configured together with a valid scrypt hash.');
if(registrationViewerUsername&&registrationViewerUsername===viewerUsername)throw new Error('Operations usernames must be distinct.');
const registrationViewerEnabled=!!(registrationViewerUsername&&registrationViewerPasswordHash);
const hash=s=>createHash('sha256').update(s).digest();
const policy=requestPolicy(),port=policy.port,secureCookie=policy.secure?'; Secure':'';
const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/customers.js':['customers.js','text/javascript'],'/milk.js':['milk.js','text/javascript'],'/kra-ui.js':['kra-ui.js','text/javascript'],'/login.js':['login.js','text/javascript'],'/style.css':['style.css','text/css'],'/operations.js':['operations.js','text/javascript'],'/portrait-placeholder.svg':['portrait-placeholder.svg','image/svg+xml'],'/favicon.ico':['favicon.ico','image/x-icon'],'/favicon-32.png':['favicon-32.png','image/png'],'/apple-touch-icon.png':['apple-touch-icon.png','image/png'],'/icon-192.png':['icon-192.png','image/png'],'/icon-512.png':['icon-512.png','image/png'],'/site.webmanifest':['site.webmanifest','application/manifest+json']};
const directoryPages=new Set(['/farmers/category/satima','/farmers/category/larger-sagana','/farmers/category/kangema','/farmers/category/others','/farmers/awaiting-categorization','/farmers/flagged-records','/farmers/kra-verification','/milk-collection','/customers','/distributors']);
const operationsPages=new Set(['/operations','/operations/login','/operations/milk-collection','/operations/kra-verification','/operations/flagged-records','/operations/customers','/operations/distributors','/operations/category/satima','/operations/category/larger-sagana','/operations/category/kangema','/operations/category/others']);
for(const bucket of ['all','verified','pending','invalid','missing','review']){
 directoryPages.add('/farmers/kra-verification/'+bucket);
 operationsPages.add('/operations/kra-verification/'+bucket);
}
for(const slug of Object.keys(customerCategoryRoutes)){
 directoryPages.add('/customers/category/'+slug);
 operationsPages.add('/operations/customers/category/'+slug);
}
directoryPages.add('/customers/awaiting-categorisation');
operationsPages.add('/operations/customers/awaiting-categorisation');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}
function sendPhotograph(res,photo){res.writeHead(200,{'Content-Type':photo.content_type,'Content-Length':photo.image_data.length,'X-Content-Type-Options':'nosniff'});res.end(photo.image_data);}
async function milkRoutes(req,res,path,url,base,actor,portal){
 if(path===base+'/farmers'&&req.method==='GET'){send(res,200,await searchMilkFarmers(pool,url.searchParams.get('q')));return true;}
 if(path===base+'/summary'&&req.method==='GET'){send(res,200,await milkSummary(pool));return true;}
 if(path===base&&req.method==='GET'){send(res,200,await listMilkCollections(pool,url.searchParams));return true;}
 if(path===base&&req.method==='POST'){
  const input=milkSubmission(req.headers),photo=await photographBody(req);
  const result=await transaction(c=>saveMilkCollection(c,input,photo,actor,portal),actor);
  send(res,result.already_saved?200:201,result);return true;
 }
 const record=path.match(new RegExp('^'+base+'/([a-f0-9-]+)$','i'));
 if(record&&req.method==='GET'){send(res,200,await milkDetail(pool,record[1]));return true;}
 const photo=path.match(new RegExp('^'+base+'/([a-f0-9-]+)/photo$','i'));
 if(photo&&req.method==='GET'){res.setHeader('Cache-Control','private, no-store');sendPhotograph(res,await milkPhoto(pool,photo[1]));return true;}
 const history=path.match(new RegExp('^'+base.replace('/milk-collections','')+'/farmers/([a-f0-9-]+)/milk-collections$','i'));
 if(history&&req.method==='GET'){send(res,200,await farmerMilkHistory(pool,history[1]));return true;}
 return false;
}
function sendPdf(res,pdf,download=false){
 const filename=encodeURIComponent(pdf.filename);
 res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'self'");
 res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':pdf.bytes.length,'Content-Disposition':`${download?'attachment':'inline'}; filename="registration.pdf"; filename*=UTF-8''${filename}`,'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Cache-Control':'private, no-store'});
 res.end(pdf.bytes);
}
async function body(req){let data='';for await(const b of req){data+=b;if(data.length>40000)throw new Problem(413,'Request too large.');}try{const value=JSON.parse(data);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new Problem(400,'Invalid JSON.');}}
function cookieToken(req,name='satima_session'){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);}
function session(req){const token=cookieToken(req);return sessions.role(token)==='administrator'?token:null;}
function viewerSession(req){const token=cookieToken(req,'satima_viewer_session'),role=viewerSessions.role(token);return role==='viewer'||role==='registration_viewer'?{token,role}:null;}
setInterval(()=>{sessions.prune();viewerSessions.prune();attempts.prune();viewerAttempts.prune();},60000).unref();
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try {
 // Render health probes can use an internal host; this route returns no farmer data.
 if(req.url==='/health'&&req.method==='GET'){await pool.query('SELECT 1');return send(res,200,{status:'healthy'});}
 if(!policy.hostAllowed(req.headers.host))throw new Problem(403,'Invalid application host.');
 const url=new URL(req.url,'http://'+req.headers.host),path=url.pathname;
 if(!['GET','HEAD'].includes(req.method)&&!policy.writeAllowed(req.headers.host,req.headers.origin))throw new Problem(403,'Use the application to submit changes.');
 const asset=files[path]||(directoryPages.has(path)?files['/']:null)||(operationsPages.has(path)?['operations.html','text/html']:null);
 if(asset&&req.method==='GET'){const [f,mime]=asset;res.writeHead(200,{'Content-Type':mime});return res.end(await readFile(new URL('./public/'+f,import.meta.url)));}
 if(path==='/api/operations/login'&&req.method==='POST'){
  if(!viewerEnabled&&!registrationViewerEnabled)throw new Problem(503,'Operations access is not configured.');
  const key=req.socket.remoteAddress;
  if(!viewerAttempts.attempt(key))throw new Problem(429,'Too many attempts. Try again in 15 minutes.');
  const credentials=await body(req);
  if(typeof credentials.username!=='string'||!credentials.username.trim())throw new Problem(400,'Please enter your username.');
  if(typeof credentials.password!=='string'||!credentials.password)throw new Problem(400,'Please enter your password.');
  const elevated=registrationViewerEnabled&&credentials.username===registrationViewerUsername;
  const expectedHash=elevated?registrationViewerPasswordHash:(viewerPasswordHash||registrationViewerPasswordHash);
  const validPassword=await verifyViewerPassword(credentials.password,expectedHash);
  if(!validPassword||(!elevated&&credentials.username!==viewerUsername))throw new Problem(401,'Incorrect username or password.');
  viewerAttempts.clear(key);
  const token=viewerSessions.issue(cookieToken(req,'satima_viewer_session'),elevated?'registration_viewer':'viewer');
  if(!token)throw new Problem(503,'Sign-in capacity reached. Try again shortly.');
  res.setHeader('Set-Cookie',`satima_viewer_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl/1000}${secureCookie}`);
  return send(res,200,{ok:true});
 }
 if(path==='/api/login'&&req.method==='POST'){
 const key=req.socket.remoteAddress;
 if(!attempts.attempt(key))throw new Problem(429,'Too many attempts. Try again in 15 minutes.');
 const b=await body(req);
 if(typeof b.username!=='string'||!b.username.trim())throw new Problem(400,'Please enter your username.');
 if(typeof b.password!=='string'||!b.password)throw new Problem(400,'Please enter your password.');
 const validPassword=timingSafeEqual(hash(b.password),hash(process.env.CMS_PASSWORD));
 if(b.username!=='admin'||!validPassword)throw new Problem(401,'Incorrect username or password.');
 attempts.clear(key);const token=sessions.issue(cookieToken(req));if(!token)throw new Problem(503,'Sign-in capacity reached. Try again shortly.');
 res.setHeader('Set-Cookie',`satima_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl/1000}${secureCookie}`);return send(res,200,{ok:true});
 }
 if(path.startsWith('/api/operations/')){
  const viewer=viewerSession(req);
  if(!viewer)throw new Problem(401,'Sign in to the Operations Portal.');
  if(path==='/api/operations/session'&&req.method==='GET')return send(res,200,{role:'viewer',sensitive_registration:viewer.role==='registration_viewer'});
  if(path==='/api/operations/logout'&&req.method==='POST'){
   viewerSessions.revoke(viewer.token);res.setHeader('Set-Cookie',`satima_viewer_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);return send(res,200,{ok:true});
  }
  if(await milkRoutes(req,res,path,url,'/api/operations/milk-collections',viewer.role==='registration_viewer'?registrationViewerUsername:viewerUsername,'Operations'))return;
  if(path==='/api/operations/kra-verification'&&req.method==='GET')return send(res,200,await listKra(pool,url.searchParams));
  if(path==='/api/operations/customers'&&req.method==='GET')return send(res,200,await listCustomers(pool,url.searchParams));
  const viewerCustomer=path.match(/^\/api\/operations\/customers\/([^/]+)$/);
  if(viewerCustomer&&req.method==='GET'){if(!uuid.test(viewerCustomer[1]))throw new Problem(400,'Invalid customer identifier.');return send(res,200,await customerDetail(pool,viewerCustomer[1]));}
  if(path==='/api/operations/flagged-records'&&req.method==='GET')return send(res,200,await listFlaggedSuppliers(pool));
  const operationsKra=path.match(/^\/api\/operations\/kra-verification\/([^/]+)$/);
  if(operationsKra){if(!uuid.test(operationsKra[1]))throw new Problem(400,'Invalid farmer identifier.');
   if(req.method==='GET')return send(res,200,await kraHistory(pool,operationsKra[1]));
   if(req.method==='POST'){const input=await body(req),actor=viewer.role==='registration_viewer'?registrationViewerUsername:viewerUsername;return send(res,201,await transaction(c=>recordKraCheck(c,operationsKra[1],input,actor,'Operations'),actor));}
  }
  if(req.method!=='GET')throw new Problem(403,'Operations access is read-only.');
  if(path==='/api/operations/farmers')return send(res,200,await listOperationsFarmers(pool,url.searchParams));
  const viewerDocuments=path.match(/^\/api\/operations\/farmers\/([^/]+)\/registration-documents$/);
  if(viewerDocuments){if(viewer.role!=='registration_viewer')throw new Problem(403,'Sensitive registration access is required.');return send(res,200,await farmerArchiveDocuments(viewerDocuments[1],true));}
  const viewerPdf=path.match(/^\/api\/operations\/farmers\/([^/]+)\/registration-documents\/([^/]+)\/pdf$/);
  if(viewerPdf){if(viewer.role!=='registration_viewer')throw new Problem(403,'Sensitive registration access is required.');if(url.searchParams.has('download'))throw new Problem(403,'Downloads require administrator access.');return sendPdf(res,await protectedPdf({farmerId:viewerPdf[1],entryId:viewerPdf[2],viewer:true}));}
  const registrationDetail=path.match(/^\/api\/operations\/farmers\/([^/]+)\/registration$/);
  if(registrationDetail){if(viewer.role!=='registration_viewer')throw new Problem(403,'Sensitive registration access is required.');if(!uuid.test(registrationDetail[1]))throw new Problem(400,'Invalid farmer identifier.');return send(res,200,await operationsFarmerRegistrationDetail(pool,registrationDetail[1],registrationViewerUsername));}
  const viewerPhoto=path.match(/^\/api\/operations\/farmers\/([^/]+)\/photo$/);
  if(viewerPhoto){if(!uuid.test(viewerPhoto[1]))throw new Problem(400,'Invalid farmer identifier.');return sendPhotograph(res,await readPhotograph(pool,viewerPhoto[1],true));}
  const viewerFarmer=path.match(/^\/api\/operations\/farmers\/([^/]+)$/);
  if(viewerFarmer){if(!uuid.test(viewerFarmer[1]))throw new Problem(400,'Invalid farmer identifier.');return send(res,200,await operationsFarmerDetail(pool,viewerFarmer[1]));}
  throw new Problem(404,'Not found.');
 }
 const token=session(req);if(!token)throw new Problem(401,'Sign in to continue.');
 if(path==='/api/session'&&req.method==='GET')return send(res,200,{operator:'Operations team'});
 if(path==='/api/logout'&&req.method==='POST'){sessions.revoke(token);res.setHeader('Set-Cookie',`satima_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);return send(res,200,{ok:true});}
 if(await milkRoutes(req,res,path,url,'/api/milk-collections','admin','Admin'))return;
 if(path==='/api/archives'){
  if(req.method==='GET')return send(res,200,await listArchiveBatches());
  if(req.method==='POST')return send(res,201,await createArchiveBatch(batchMetadata(req.headers),await readPdfBody(req)));
 }
 const originalArchive=path.match(/^\/api\/archives\/([A-Z0-9-]+)\/original\.pdf$/);
 if(originalArchive&&req.method==='GET')return sendPdf(res,await protectedPdf({batchId:originalArchive[1],master:true,download:url.searchParams.has('download')}),url.searchParams.has('download'));
 const archiveEntries=path.match(/^\/api\/archives\/([A-Z0-9-]+)\/entries$/);
 if(archiveEntries){
  if(req.method==='GET')return send(res,200,await listArchiveEntries(archiveEntries[1]));
  if(req.method==='POST')return send(res,201,await saveArchiveEntry(archiveEntries[1],await body(req)));
 }
 const archiveEntryPdf=path.match(/^\/api\/archives\/([A-Z0-9-]+)\/entries\/([^/]+)\/pdf$/);
 if(archiveEntryPdf&&req.method==='GET')return sendPdf(res,await protectedPdf({batchId:archiveEntryPdf[1],entryId:archiveEntryPdf[2],download:url.searchParams.has('download')}),url.searchParams.has('download'));
 const archiveEntry=path.match(/^\/api\/archives\/([A-Z0-9-]+)\/entries\/([^/]+)$/);
 if(archiveEntry&&req.method==='PATCH')return send(res,200,await saveArchiveEntry(archiveEntry[1],await body(req),archiveEntry[2]));
 if(path==='/api/farmers'&&req.method==='GET')return send(res,200,await listFarmers(pool,url.searchParams));
 if(path==='/api/customers'&&req.method==='GET')return send(res,200,await listCustomers(pool,url.searchParams));
 const adminCustomer=path.match(/^\/api\/customers\/([^/]+)$/);
 if(adminCustomer&&req.method==='GET'){if(!uuid.test(adminCustomer[1]))throw new Problem(400,'Invalid customer identifier.');return send(res,200,await customerDetail(pool,adminCustomer[1]));}
 if(path==='/api/flagged-records'&&req.method==='GET')return send(res,200,await listFlaggedSuppliers(pool));
 if(path==='/api/kra-verification'&&req.method==='GET')return send(res,200,await listKra(pool,url.searchParams));
 const kraRecord=path.match(/^\/api\/kra-verification\/([^/]+)$/);
 if(kraRecord){if(!uuid.test(kraRecord[1]))throw new Problem(400,'Invalid farmer identifier.');
  if(req.method==='GET')return send(res,200,await kraHistory(pool,kraRecord[1]));
  if(req.method==='POST'){const input=await body(req);return send(res,201,await transaction(c=>recordKraCheck(c,kraRecord[1],input,'Administrator'),'Administrator'));}
 }
 if(path==='/api/farmers'&&req.method==='POST'){const b=await body(req);const f=await transaction(c=>createFarmer(c,b));return send(res,201,{id:f.id,customer_id:f.customer_id});}
 const farmerDocuments=path.match(/^\/api\/farmers\/([^/]+)\/registration-documents$/);
 if(farmerDocuments&&req.method==='GET')return send(res,200,await farmerArchiveDocuments(farmerDocuments[1]));
 const farmerPdf=path.match(/^\/api\/farmers\/([^/]+)\/registration-documents\/([^/]+)\/pdf$/);
 if(farmerPdf&&req.method==='GET')return sendPdf(res,await protectedPdf({farmerId:farmerPdf[1],entryId:farmerPdf[2],download:url.searchParams.has('download')}),url.searchParams.has('download'));
 const photoPath=path.match(/^\/api\/farmers\/([^/]+)\/photo$/);
 if(photoPath){if(!uuid.test(photoPath[1]))throw new Problem(400,'Invalid farmer identifier.');
  if(req.method==='GET')return sendPhotograph(res,await readPhotograph(pool,photoPath[1]));
  if(req.method==='PUT'){const photo=await photographBody(req);await transaction(c=>savePhotograph(c,photoPath[1],photo));return send(res,200,{ok:true});}
  if(req.method==='DELETE'){await transaction(c=>removePhotograph(c,photoPath[1]));return send(res,200,{ok:true});}
 }
 const m=path.match(/^\/api\/farmers\/([^/]+)(?:\/(issues))?$/);
 if(m){if(!uuid.test(m[1]))throw new Problem(400,'Invalid farmer identifier.');
 if(!m[2]&&req.method==='GET')return send(res,200,await detail(m[1]));
 if(!m[2]&&req.method==='PUT'){const b=await body(req);return send(res,200,await transaction(c=>updateFarmer(c,m[1],b)));}
 if(m[2]&&req.method==='POST'){
 const b=await body(req),field=text(b.field_name,'Field',true),description=text(b.description,'Description',true,2000);
 return send(res,201,await transaction(async c=>(await c.query('INSERT INTO farmer_data_issues(farmer_id,field_name,description) VALUES($1,$2,$3) RETURNING id',[m[1],field,description])).rows[0]));
 }}
 const im=path.match(/^\/api\/issues\/([^/]+)$/);
 if(im&&req.method==='PATCH'){
 if(!uuid.test(im[1]))throw new Problem(400,'Invalid issue identifier.');
 const b=await body(req),note=text(b.resolution_note,'Resolution note',true,2000);
 const result=await transaction(async c=>{const {rows:[issue]}=await c.query("UPDATE farmer_data_issues SET status='resolved',resolution_note=$2,resolved_at=now() WHERE id=$1 AND status='open' RETURNING id",[im[1],note]);if(!issue)throw new Problem(409,'Issue already resolved or not found.');return issue;});
 return send(res,200,result);
 }
 throw new Problem(404,'Not found.');
 }catch(e){
 let status=e.status||500,message=e.status?e.message:'The request could not be completed. Try again.';
 if(e.code==='23505'){status=409;message=e.constraint?.startsWith('registration_archive_')?'This archive or page range is already stored.':'That National ID or KRA PIN is already registered. Check for a duplicate farmer.';}
 if(e.constraint==='active_farmer_evidence'){status=400;message='Active status requires complete, current identity checks, consent and verified payment details, with no high-priority open notes.';}
 if(e.constraint!=='active_farmer_evidence'&&['23514','23502','22007','22008','22P02'].includes(e.code)){status=400;message='One or more fields are invalid. Check your entries.';}
 if(e.code==='23503'){status=400;message='Related farmer record not found.';}
 if(status===500)console.error('Request failed',e.code||e.name); // No queries, values or secrets.
 send(res,status,{error:message});
 }
});
server.requestTimeout=120000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=100;
server.listen(port,process.env.LISTEN_HOST||'127.0.0.1',()=>console.log(`Satima CMS listening on container port ${port}`));
process.on('SIGTERM',()=>server.close(()=>pool.end().then(()=>process.exit(0))));

import http from 'node:http';
import {requestPolicy} from './hosting.mjs';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pool,Problem,text,transaction,createFarmer,updateFarmer,detail} from './store.mjs';
if(!process.env.CMS_PASSWORD||process.env.CMS_PASSWORD.length<16)throw new Error('CMS_PASSWORD must be at least 16 characters.');
const sessions=new Map(),attempts=new Map(),ttl=8*3600*1000;
const hash=s=>createHash('sha256').update(s).digest();
const policy=requestPolicy(),port=policy.port,secureCookie=policy.secure?'; Secure':'';
const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}
async function body(req){let data='';for await(const b of req){data+=b;if(data.length>40000)throw new Problem(413,'Request too large.');}try{const value=JSON.parse(data);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new Problem(400,'Invalid JSON.');}}
function session(req){const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('satima_session='))?.slice(15);const exp=sessions.get(token);return exp>Date.now()?token:null;}
setInterval(()=>{for(const[k,v]of sessions)if(v<Date.now())sessions.delete(k);for(const[k,v]of attempts)if(v.until<Date.now())attempts.delete(k);},60000).unref();
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try {
 // Render health probes can use an internal host; this route returns no farmer data.
 if(req.url==='/health'&&req.method==='GET'){await pool.query('SELECT 1');return send(res,200,{status:'healthy'});}
 if(!policy.hostAllowed(req.headers.host))throw new Problem(403,'Invalid application host.');
 const url=new URL(req.url,'http://'+req.headers.host),path=url.pathname;
 if(!['GET','HEAD'].includes(req.method)&&!policy.writeAllowed(req.headers.host,req.headers.origin))throw new Problem(403,'Use the application to submit changes.');
 if(files[path]&&req.method==='GET'){const [f,mime]=files[path];res.writeHead(200,{'Content-Type':mime});return res.end(await readFile(new URL('./public/'+f,import.meta.url)));}
 if(path==='/api/login'&&req.method==='POST'){
 const key=req.socket.remoteAddress;let a=attempts.get(key);if(!a||a.until<Date.now())a={count:0,until:Date.now()+900000};
 if(a.count>=10)throw new Problem(429,'Too many attempts. Try again in 15 minutes.');
 const b=await body(req);a.count++;attempts.set(key,a);
 if(typeof b.password!=='string'||!timingSafeEqual(hash(b.password),hash(process.env.CMS_PASSWORD)))throw new Problem(401,'Incorrect password.');
 attempts.delete(key);const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+ttl);
 res.setHeader('Set-Cookie',`satima_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl/1000}${secureCookie}`);return send(res,200,{ok:true});
 }
 const token=session(req);if(!token)throw new Problem(401,'Sign in to continue.');
 if(path==='/api/session'&&req.method==='GET')return send(res,200,{operator:'Local operator'});
 if(path==='/api/logout'&&req.method==='POST'){sessions.delete(token);res.setHeader('Set-Cookie',`satima_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);return send(res,200,{ok:true});}
 if(path==='/api/farmers'&&req.method==='GET'){
 const q=(url.searchParams.get('q')||'').slice(0,100),scope=url.searchParams.get('scope')||'registered';
 const where=`($1='' OR concat_ws(' ',f.full_name,f.customer_id,f.primary_phone,f.registered_business_name,
 f.village_area,f.county,f.location,f.sub_location,f.sub_county,f.physical_address,
 f.status::text,replace(f.status::text,'_',' '),f.registration_date::text,
 CASE WHEN EXISTS(SELECT FROM farmer_data_issues i WHERE i.farmer_id=f.id AND i.status='open')
 THEN (SELECT count(*)::text||' open' FROM farmer_data_issues i WHERE i.farmer_id=f.id AND i.status='open')
 ELSE 'No open notes' END) ILIKE '%'||$1||'%') AND ($2='all' OR ($2='registered' AND f.registered_by<>'TEST STAFF') OR ($2='demo' AND f.registered_by='TEST STAFF'))`;
 const data=await pool.query(`SELECT f.id,f.customer_id,f.full_name,f.primary_phone,f.county,f.village_area,f.status,f.registration_date::text,
 (SELECT count(*)::int FROM farmer_data_issues i WHERE i.farmer_id=f.id AND i.status='open') AS open_issues
 FROM farmers f WHERE ${where} ORDER BY f.created_at DESC,f.id LIMIT 200`,[q,scope]);
 const {rows:[stats]}=await pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE f.status='pending_verification')::int AS pending,
 count(*) FILTER(WHERE EXISTS(SELECT FROM farmer_data_issues i WHERE i.farmer_id=f.id AND i.status='open'))::int AS needs_review
 FROM farmers f WHERE ${where}`,[q,scope]);
 return send(res,200,{farmers:data.rows,stats});
 }
 if(path==='/api/farmers'&&req.method==='POST'){const b=await body(req);const f=await transaction(c=>createFarmer(c,b));return send(res,201,{id:f.id,customer_id:f.customer_id});}
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
 if(e.code==='23505'){status=409;message='That National ID or KRA PIN is already registered. Check for a duplicate farmer.';}
 if(['23514','23502','22007','22008','22P02'].includes(e.code)){status=400;message='One or more fields are invalid. Check your entries.';}
 if(e.code==='23503'){status=400;message='Related farmer record not found.';}
 if(status===500)console.error('Request failed',e.code||e.name); // No queries, values or secrets.
 send(res,status,{error:message});
 }
});
server.listen(port,process.env.LISTEN_HOST||'127.0.0.1',()=>console.log(`Satima CMS listening on container port ${port}`));
process.on('SIGTERM',()=>server.close(()=>pool.end().then(()=>process.exit(0))));

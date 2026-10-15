import nodemailer from 'nodemailer';
import {Problem,text} from './store.mjs';

export const categories=['Technical Issue / System Error','Login / Account Access','Farmer Registration / Record Update','Customer Registration / Record Update','Distributor Registration / Record Update','Milk Collection Issue','Milk Processing / Quality Issue','Milk Distribution / Delivery Issue','Data Correction / Discrepancy','Feature Request / System Improvement','General Inquiry / Other'];
const kinds=['Farmer ID','Customer ID','Distributor ID','Collection ID','Processing Batch ID','Distribution Reference'];
const referenceFormat={'Farmer ID':/^SF-F-[0-9]{4,}$/i,'Customer ID':/^C[0-9]{4,}$/i,'Distributor ID':/^D[0-9]{4,}$/i,'Collection ID':/^MC[0-9]{6,}$/i,'Processing Batch ID':/^MP[0-9]{6,}$/i,'Distribution Reference':/^MD[0-9]{6,}$/i};
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function validateTicket(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Problem(400,'Enter a support request.');
 if(!uuid.test(input.idempotency_key||''))throw new Problem(400,'Refresh the form and try again.');
 if(!categories.includes(input.category))throw new Problem(400,'Choose a request category.');
 const subject=text(input.subject,'Subject',true,160),description=text(input.description,'Description',true,5000),requester=text(input.requester_name,'Requester name',true,150);
 if(subject.length<3||description.length<10||requester.length<2)throw new Problem(400,'Add a subject, your name and a description of at least 10 characters.');
 const email=text(input.contact_email,'Email',false,254),phone=text(input.contact_phone,'Phone',false,40);
 if(!email&&!phone)throw new Problem(400,'Enter an email address or phone number.');
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Problem(400,'Enter a valid email address.');
 if(phone&&!/^\+?[0-9 ()-]{7,40}$/.test(phone))throw new Problem(400,'Enter a valid phone number.');
 const priority=input.priority||'Normal';if(!['Normal','High','Urgent'].includes(priority))throw new Problem(400,'Choose a valid priority.');
 const relatedType=text(input.related_record_type,'Related record type',false,40),reference=text(input.related_reference,'Related reference',false,80);
 if(Boolean(relatedType)!==Boolean(reference)||relatedType&&!kinds.includes(relatedType)||reference&&!referenceFormat[relatedType]?.test(reference))throw new Problem(400,'Choose a valid related record type and reference.');
 return {idempotency_key:input.idempotency_key,category:input.category,subject,description,requester_name:requester,contact_email:email,contact_phone:phone,priority,related_record_type:relatedType,related_reference:reference};
}
export async function createTicket(db,input,portal){
 const a=validateTicket(input);
 const {rows:[row]}=await db.query(`INSERT INTO support_tickets(idempotency_key,category,subject,description,requester_name,contact_email,contact_phone,priority,related_record_type,related_reference,source_portal)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id,ticket_reference,notification_status`,[a.idempotency_key,a.category,a.subject,a.description,a.requester_name,a.contact_email,a.contact_phone,a.priority,a.related_record_type,a.related_reference,portal]);
 if(row){await db.query("INSERT INTO support_ticket_events(ticket_id,action,new_status,actor,source_portal) VALUES($1,'Submitted','Open',$2,$3)",[row.id,a.requester_name,portal]);return {...row,already_saved:false};}
 const {rows:[old]}=await db.query('SELECT id,ticket_reference,notification_status,source_portal FROM support_tickets WHERE idempotency_key=$1',[a.idempotency_key]);
 if(old.source_portal!==portal)throw new Problem(409,'This request has already been submitted.');
 return {id:old.id,ticket_reference:old.ticket_reference,notification_status:old.notification_status,already_saved:true};
}
export async function listTickets(db,params){
 const q=(params.get('q')||'').trim().slice(0,100),status=params.get('status')||'',priority=params.get('priority')||'';
 if(status&&!['Open','In Progress','Resolved','Closed'].includes(status)||priority&&!['Normal','High','Urgent'].includes(priority))throw new Problem(400,'Invalid ticket filter.');
 const {rows}=await db.query(`SELECT id,ticket_reference,category,subject,requester_name,priority,status,source_portal,notification_status,submitted_at,revision FROM support_tickets
 WHERE ($1='' OR ticket_reference ILIKE '%'||$1||'%' OR category ILIKE '%'||$1||'%' OR subject ILIKE '%'||$1||'%') AND ($2='' OR status=$2) AND ($3='' OR priority=$3) ORDER BY submitted_at DESC LIMIT 200`,[q,status,priority]);
 return {tickets:rows};
}
export async function ticketDetail(db,id){if(!uuid.test(id))throw new Problem(400,'Invalid ticket identifier.');
 const {rows:[ticket]}=await db.query('SELECT * FROM support_tickets WHERE id=$1',[id]);if(!ticket)throw new Problem(404,'Ticket not found.');
 const {rows:history}=await db.query('SELECT action,previous_status,new_status,note,actor,source_portal,created_at FROM support_ticket_events WHERE ticket_id=$1 ORDER BY id',[id]);return {ticket,history};
}
export async function updateTicket(db,id,input){
 if(!uuid.test(id))throw new Problem(400,'Invalid ticket identifier.');
 const status=input?.status,note=text(input?.note,'Administrative note',false,2000),revision=Number(input?.revision);
 if(!['Open','In Progress','Resolved','Closed'].includes(status)||!Number.isInteger(revision)||revision<1)throw new Problem(400,'Choose a valid status and reload the latest ticket.');
 const {rows:[old]}=await db.query('SELECT status,revision FROM support_tickets WHERE id=$1 FOR UPDATE',[id]);if(!old)throw new Problem(404,'Ticket not found.');
 if(old.revision!==revision)throw new Problem(409,'This ticket changed. Reload before saving.');
 if(old.status===status&&!note)throw new Problem(400,'Add a note or change the status.');
 const {rows:[ticket]}=await db.query('UPDATE support_tickets SET status=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,ticket_reference,status,revision',[id,status]);
 await db.query("INSERT INTO support_ticket_events(ticket_id,action,previous_status,new_status,note,actor,source_portal) VALUES($1,'Status update',$2,$3,$4,'admin','Admin')",[id,old.status,status,note]);
 return ticket;
}
export function mailConfigured(env=process.env){return Boolean(env.CONTACT_SUPPORT_EMAIL&&env.SUPPORT_SMTP_HOST&&['465','587'].includes(String(env.SUPPORT_SMTP_PORT))&&env.SUPPORT_SMTP_USER&&env.SUPPORT_SMTP_PASSWORD&&env.SUPPORT_EMAIL_FROM);}
export function emailSafeDescription(value){return String(value).replace(/^.*(?:KRA|M-?Pesa|national ID|identity document|passport|signature|consent|payment|\bPIN\b).*$/gim,'[SENSITIVE DETAIL REDACTED]').replace(/\b\d{7,12}\b/g,'[NUMBER REDACTED]');}
export async function deliverTicket(db,id,env=process.env,sendMail,force=false){
 if(!mailConfigured(env)){const {rows:[existing]}=await db.query('SELECT notification_status FROM support_tickets WHERE id=$1',[id]);if(!existing)throw new Problem(404,'Ticket not found.');return {notification_status:existing.notification_status};}
 const {rows:[ticket]}=await db.query(`UPDATE support_tickets SET notification_claimed_at=now(),notification_attempts=notification_attempts+1
 WHERE id=$1 AND notification_status<>'sent' AND (notification_next_attempt_at IS NULL OR notification_next_attempt_at<=now() OR $2::boolean) AND (notification_claimed_at IS NULL OR notification_claimed_at<now()-interval '5 minutes') RETURNING *`,[id,force]);
 if(!ticket){const {rows:[existing]}=await db.query('SELECT notification_status FROM support_tickets WHERE id=$1',[id]);if(!existing)throw new Problem(404,'Ticket not found.');return {notification_status:existing.notification_status};}
 const lines=['Satima Farmhouse CMS Support',`Ticket: ${ticket.ticket_reference}`,`Category: ${ticket.category}`,`Subject: ${emailSafeDescription(ticket.subject)}`,`Priority: ${ticket.priority}`,`Requester: ${ticket.requester_name}`,`Contact: ${[ticket.contact_email,ticket.contact_phone].filter(Boolean).join(' / ')}`,`Submitted: ${new Intl.DateTimeFormat('en-KE',{timeZone:'Africa/Nairobi',dateStyle:'medium',timeStyle:'short'}).format(ticket.submitted_at)}`,`Source: ${ticket.source_portal}`,`Related record: ${ticket.related_reference||'None'}`,'',emailSafeDescription(ticket.description)];
 try{const transport=sendMail?null:nodemailer.createTransport({host:env.SUPPORT_SMTP_HOST,port:Number(env.SUPPORT_SMTP_PORT),secure:Number(env.SUPPORT_SMTP_PORT)===465,requireTLS:Number(env.SUPPORT_SMTP_PORT)!==465,auth:{user:env.SUPPORT_SMTP_USER,pass:env.SUPPORT_SMTP_PASSWORD}});
  const sender=sendMail||((message)=>transport.sendMail(message));
  await sender({to:env.CONTACT_SUPPORT_EMAIL,from:env.SUPPORT_EMAIL_FROM,subject:`Satima CMS Support | ${ticket.ticket_reference} | ${ticket.category}`,text:lines.join('\n'),messageId:`<${ticket.id}@satima-cms-support>`});
  await db.query("UPDATE support_tickets SET notification_status='sent',notification_sent_at=now(),notification_claimed_at=NULL,notification_next_attempt_at=NULL WHERE id=$1",[id]);return {notification_status:'sent'};
 }catch{await db.query("UPDATE support_tickets SET notification_status='failed',notification_claimed_at=NULL,notification_next_attempt_at=now()+interval '15 minutes' WHERE id=$1",[id]);return {notification_status:'failed'};}
}
export async function retryPending(db){if(!mailConfigured())return;const {rows}=await db.query("SELECT id FROM support_tickets WHERE notification_status IN ('pending','failed') AND (notification_next_attempt_at IS NULL OR notification_next_attempt_at<=now()) AND (notification_claimed_at IS NULL OR notification_claimed_at<now()-interval '5 minutes') ORDER BY submitted_at LIMIT 10");for(const row of rows)await deliverTicket(db,row.id);}

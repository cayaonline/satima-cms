import test from 'node:test';
import assert from 'node:assert/strict';
import {reportingPeriod} from '../home.mjs';
import {validateTicket,categories,emailSafeDescription,deliverTicket,mailConfigured} from '../support.mjs';
const id='12345678-1234-4234-8234-123456789abc';
test('Kenya reporting periods and custom date validation',()=>{
 assert.deepEqual(reportingPeriod(new URLSearchParams(),'2026-10-16'),{period:'custom',from:'2026-09-01',to:'2026-09-30'});
 assert.deepEqual(reportingPeriod(new URLSearchParams('period=today'),'2026-10-16'),{period:'today',from:'2026-10-16',to:'2026-10-16'});
 assert.deepEqual(reportingPeriod(new URLSearchParams('period=week'),'2026-10-16'),{period:'week',from:'2026-10-12',to:'2026-10-16'});
 assert.deepEqual(reportingPeriod(new URLSearchParams('period=month'),'2026-10-16'),{period:'month',from:'2026-10-01',to:'2026-10-16'});
 assert.throws(()=>reportingPeriod(new URLSearchParams('period=custom&from=2026-10-17&to=2026-10-18'),'2026-10-16'));
 assert.throws(()=>reportingPeriod(new URLSearchParams('period=custom&from=2026-02-30&to=2026-10-16'),'2026-10-16'));
});
test('notification marks sent only after transport succeeds and retains failures',async()=>{
 const env={CONTACT_SUPPORT_EMAIL:'support@example.test',SUPPORT_SMTP_HOST:'smtp.example.test',SUPPORT_SMTP_PORT:'587',SUPPORT_SMTP_USER:'test',SUPPORT_SMTP_PASSWORD:'test',SUPPORT_EMAIL_FROM:'cms@example.test'};
 const ticket={id,ticket_reference:'SF-SUP-00001',category:categories[0],subject:'Issue',priority:'Normal',requester_name:'Test Person',contact_email:'person@example.test',contact_phone:null,submitted_at:new Date('2026-10-16T09:00:00Z'),source_portal:'Operations',related_reference:null,description:'KRA PIN P123456789A appears on the form.'};
 let state='pending',message;
 const db={async query(sql){if(sql.startsWith('UPDATE support_tickets SET notification_claimed_at'))return {rows:[ticket]};if(sql.includes("notification_status='sent'"))state='sent';if(sql.includes("notification_status='failed'"))state='failed';return {rows:[]};}};
 assert.equal((await deliverTicket(db,id,env,async m=>{message=m;})).notification_status,'sent');assert.equal(state,'sent');assert.doesNotMatch(message.text,/P123456789A/);
 assert.equal((await deliverTicket(db,id,env,async()=>{throw new Error('private transport error');})).notification_status,'failed');assert.equal(state,'failed');
});
test('HTTPS notification sends to the configured inbox and only marks accepted requests sent',async()=>{
 const env={CONTACT_SUPPORT_EMAIL:'support@example.test',SUPPORT_EMAIL_FROM:'cms@example.test',SUPPORT_RESEND_API_KEY:'test-key'};
 assert.equal(mailConfigured(env),true);
 const ticket={id,ticket_reference:'SF-SUP-00001',category:categories[0],subject:'Issue',priority:'Normal',requester_name:'Test Person',contact_email:'person@example.test',contact_phone:null,submitted_at:new Date('2026-10-16T09:00:00Z'),source_portal:'Operations',related_reference:null,description:'The page does not load.'};
 let state='pending',request,accepted=true;
 const db={async query(sql){if(sql.startsWith('UPDATE support_tickets SET notification_claimed_at'))return {rows:[ticket]};if(sql.includes("notification_status='sent'"))state='sent';if(sql.includes("notification_status='failed'"))state='failed';return {rows:[]};}};
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{request={url,options};return {ok:accepted};};
 try{
  assert.equal((await deliverTicket(db,id,env)).notification_status,'sent');
  assert.equal(request.url,'https://api.resend.com/emails');
  assert.equal(request.options.headers['Idempotency-Key'],id);
  assert.deepEqual(JSON.parse(request.options.body).to,['support@example.test']);
  accepted=false;
  assert.equal((await deliverTicket(db,id,env)).notification_status,'failed');
  assert.equal(state,'failed');
 }finally{globalThis.fetch=originalFetch;}
});
test('support input validates required fields, contact and category',()=>{
 const good={idempotency_key:id,category:categories[0],subject:'System issue',description:'The collection form does not load.',requester_name:'Test Operator',contact_email:'operator@example.test',priority:'Normal'};
 assert.equal(validateTicket(good).contact_email,'operator@example.test');
 assert.throws(()=>validateTicket({...good,contact_email:''}));
 assert.throws(()=>validateTicket({...good,category:'Not a category'}));
 assert.throws(()=>validateTicket({...good,description:'short'}));
 assert.throws(()=>validateTicket({...good,related_reference:'SF-F-0001'}));
 assert.equal(validateTicket({...good,related_record_type:'Farmer ID',related_reference:'SF-F-0001'}).related_reference,'SF-F-0001');
 assert.doesNotMatch(emailSafeDescription('PIN P123456789A, national ID 12345678'),/P123456789A|12345678/);
});

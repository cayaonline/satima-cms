import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionStore,LoginLimiter,hashViewerPassword,verifyViewerPassword,validViewerHash} from '../security.mjs';
test('sessions expire, rotate, revoke and store only hashed tokens',()=>{
 let now=100;const s=new SessionStore({ttl:10,limit:2,now:()=>now});const token=s.issue();assert(s.valid(token));assert(!s.entries.has(token));assert(!s.valid('garbage'));const next=s.issue(token);assert(!s.valid(token));assert(s.valid(next));s.revoke(next);assert(!s.valid(next));const a=s.issue();s.issue();assert.equal(s.issue(),null);now=111;assert(!s.valid(a));assert(s.issue());
});
test('login attempt limits are bounded and reset after the window',()=>{
 let now=0;const l=new LoginLimiter({limit:2,window:10,maxKeys:2,now:()=>now});assert(l.attempt('a'));assert(l.attempt('a'));assert(!l.attempt('a'));assert(l.attempt('b'));assert(!l.attempt('c'));l.clear('b');assert(l.attempt('c'));now=11;assert(l.attempt('a'));assert.equal(l.entries.size,1);
});
test('viewer credentials use a salted scrypt hash and sessions retain distinct roles',async()=>{
 await assert.rejects(hashViewerPassword('short-secret'),/at least 14 characters/);
 const password='viewer-test-password-long-enough',first=await hashViewerPassword(password),second=await hashViewerPassword(password);
 assert(validViewerHash(first));assert.notEqual(first,second);assert(!first.includes(password));
 assert(await verifyViewerPassword(password,first));assert(!await verifyViewerPassword('incorrect-viewer-password',first));assert(!await verifyViewerPassword(password,'invalid'));
 const sessions=new SessionStore(),admin=sessions.issue(null,'administrator'),viewer=sessions.issue(null,'viewer');
 assert.equal(sessions.role(admin),'administrator');assert.equal(sessions.role(viewer),'viewer');
 sessions.revoke(viewer);assert.equal(sessions.role(viewer),null);assert.equal(sessions.role(admin),'administrator');
});

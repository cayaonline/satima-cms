import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionStore,LoginLimiter} from '../security.mjs';
test('sessions expire, rotate, revoke and store only hashed tokens',()=>{
 let now=100;const s=new SessionStore({ttl:10,limit:2,now:()=>now});const token=s.issue();assert(s.valid(token));assert(!s.entries.has(token));assert(!s.valid('garbage'));const next=s.issue(token);assert(!s.valid(token));assert(s.valid(next));s.revoke(next);assert(!s.valid(next));const a=s.issue();s.issue();assert.equal(s.issue(),null);now=111;assert(!s.valid(a));assert(s.issue());
});
test('login attempt limits are bounded and reset after the window',()=>{
 let now=0;const l=new LoginLimiter({limit:2,window:10,maxKeys:2,now:()=>now});assert(l.attempt('a'));assert(l.attempt('a'));assert(!l.attempt('a'));assert(l.attempt('b'));assert(!l.attempt('c'));l.clear('b');assert(l.attempt('c'));now=11;assert(l.attempt('a'));assert.equal(l.entries.size,1);
});

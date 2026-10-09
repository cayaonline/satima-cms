import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestPolicy} from '../hosting.mjs';
test('local origins and cookies retain existing behavior',()=>{
 const p=requestPolicy({PORT:'3000',CMS_PORT:'3001'});
 assert.equal(p.secure,false);assert(p.writeAllowed('localhost:3001','http://localhost:3001'));
 assert(!p.hostAllowed('attacker.example'));assert(!p.writeAllowed('localhost:3001','https://attacker.example'));
});
test('hosted requests require the configured HTTPS host and origin',()=>{
 const p=requestPolicy({RENDER:'true',RENDER_EXTERNAL_URL:'https://satima.example'});
 assert(p.secure);assert(p.writeAllowed('satima.example','https://satima.example'));
 for(const origin of [undefined,'http://satima.example','https://attacker.example'])assert(!p.writeAllowed('satima.example',origin));
 assert(!p.hostAllowed('localhost:3000'));assert(!p.writeAllowed('attacker.example','https://satima.example'));
 for(const PUBLIC_ORIGIN of ['http://satima.example','https://user:pass@satima.example','https://satima.example/path'])assert.throws(()=>requestPolicy({PUBLIC_ORIGIN}));
 assert.throws(()=>requestPolicy({RENDER:'true'}));
});

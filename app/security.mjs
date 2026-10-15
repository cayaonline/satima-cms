import {createHash,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const tokenHash=token=>createHash('sha256').update(token).digest('hex');
const scrypt=promisify(scryptCallback);
export class SessionStore{
 constructor({ttl=8*3600000,limit=2048,now=Date.now}={}){this.ttl=ttl;this.limit=limit;this.now=now;this.entries=new Map();}
 prune(){for(const [key,entry] of this.entries)if(entry.expires<=this.now())this.entries.delete(key);}
 role(token){if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))return null;const key=tokenHash(token),entry=this.entries.get(key);if(!entry||entry.expires<=this.now()){this.entries.delete(key);return null;}return entry.role;}
 valid(token){return this.role(token)!==null;}
 revoke(token){if(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token))this.entries.delete(tokenHash(token));}
 issue(previous,role='administrator'){this.prune();this.revoke(previous);if(this.entries.size>=this.limit)return null;const token=randomBytes(32).toString('hex');this.entries.set(tokenHash(token),{expires:this.now()+this.ttl,role});return token;}
}
export class PersistentSessionStore{
 constructor(pool,{ttl=30*86400000}={}){this.pool=pool;this.ttl=ttl;}
 async role(token){
  if(typeof token!=='string'||!unsignedToken.test(token))return null;
  const {rows:[entry]}=await this.pool.query('SELECT role FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()',[tokenHash(token)]);
  return entry?.role||null;
 }
 async revoke(token){if(typeof token==='string'&&unsignedToken.test(token))await this.pool.query('DELETE FROM auth_sessions WHERE token_hash=$1',[tokenHash(token)]);}
 async issue(previous,role='administrator'){
  const token=randomBytes(32).toString('hex');
  const client=await this.pool.connect();
  try{await client.query('BEGIN');if(typeof previous==='string'&&unsignedToken.test(previous))await client.query('DELETE FROM auth_sessions WHERE token_hash=$1',[tokenHash(previous)]);
   await client.query('INSERT INTO auth_sessions(token_hash,role,expires_at) VALUES($1,$2,now()+$3::interval)',[tokenHash(token),role,`${this.ttl} milliseconds`]);await client.query('COMMIT');return token;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async prune(){await this.pool.query('DELETE FROM auth_sessions WHERE expires_at<=now()');}
}
const unsignedToken=/^[a-f0-9]{64}$/;
export async function hashViewerPassword(password,salt=randomBytes(16)){
 if(typeof password!=='string'||password.length<9)throw new Error('Viewer password must be at least 9 characters.');
 const derived=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:32*1024*1024});
 return `scrypt$16384$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
}
export function validViewerHash(value){return typeof value==='string'&&/^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(value);}
export async function verifyViewerPassword(password,encoded){
 if(typeof password!=='string'||password.length>1024||!validViewerHash(encoded))return false;
 const [,N,r,p,salt,expected]=encoded.split('$');
 const derived=await scrypt(password,Buffer.from(salt,'hex'),64,{N:Number(N),r:Number(r),p:Number(p),maxmem:32*1024*1024});
 return timingSafeEqual(derived,Buffer.from(expected,'hex'));
}
export class LoginLimiter{
 constructor({limit=10,window=900000,maxKeys=10000,now=Date.now}={}){Object.assign(this,{limit,window,maxKeys,now});this.entries=new Map();}
 prune(){for(const [key,a] of this.entries)if(a.until<=this.now())this.entries.delete(key);}
 attempt(key){let a=this.entries.get(key);if(!a||a.until<=this.now()){this.prune();if(this.entries.size>=this.maxKeys)return false;a={count:0,until:this.now()+this.window};this.entries.set(key,a);}if(a.count>=this.limit)return false;a.count++;return true;}
 clear(key){this.entries.delete(key);}
}

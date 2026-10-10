import {createHash,randomBytes} from 'node:crypto';
const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export class SessionStore{
 constructor({ttl=8*3600000,limit=2048,now=Date.now}={}){this.ttl=ttl;this.limit=limit;this.now=now;this.entries=new Map();}
 prune(){for(const [key,expires] of this.entries)if(expires<=this.now())this.entries.delete(key);}
 valid(token){if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))return false;const key=tokenHash(token),expires=this.entries.get(key);if(!expires||expires<=this.now()){this.entries.delete(key);return false;}return true;}
 revoke(token){if(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token))this.entries.delete(tokenHash(token));}
 issue(previous){this.prune();this.revoke(previous);if(this.entries.size>=this.limit)return null;const token=randomBytes(32).toString('hex');this.entries.set(tokenHash(token),this.now()+this.ttl);return token;}
}
export class LoginLimiter{
 constructor({limit=10,window=900000,maxKeys=10000,now=Date.now}={}){Object.assign(this,{limit,window,maxKeys,now});this.entries=new Map();}
 prune(){for(const [key,a] of this.entries)if(a.until<=this.now())this.entries.delete(key);}
 attempt(key){let a=this.entries.get(key);if(!a||a.until<=this.now()){this.prune();if(this.entries.size>=this.maxKeys)return false;a={count:0,until:this.now()+this.window};this.entries.set(key,a);}if(a.count>=this.limit)return false;a.count++;return true;}
 clear(key){this.entries.delete(key);}
}

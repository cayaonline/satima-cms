// Encrypted backups stay on the operator's Mac; credentials never enter command arguments.
import {spawn} from 'node:child_process';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile,stat,open,rename,unlink} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Writable} from 'node:stream';
import {rootCertificates} from 'node:tls';
import {resolve} from 'node:path';
const magic=Buffer.from('SATIMA01'),docker=process.env.DOCKER||'/Applications/Docker.app/Contents/Resources/bin/docker';
async function key(){const path=process.env.BACKUP_KEY_FILE;if(!path)throw new Error('BACKUP_KEY_FILE is required');const info=await stat(path);if(info.mode&0o077)throw new Error('Backup key must be private (mode 0600)');const k=await readFile(path);if(k.length!==32)throw new Error('Backup key must contain 32 random bytes');return k;}
async function run(args,env,input,output){const p=spawn(docker,args,{env,stdio:['pipe','pipe','pipe']});const errors=[];p.stderr.on('data',b=>{if(errors.reduce((n,b)=>n+b.length,0)<2000000)errors.push(b);});const done=new Promise((yes,no)=>{p.once('error',no);p.once('close',code=>code===0?yes():no(new Error('PostgreSQL backup/restore command failed')));});const jobs=[done];if(input)jobs.push(pipeline(input,p.stdin));else p.stdin.end();if(output)jobs.push(pipeline(p.stdout,output));else p.stdout.resume();try{await Promise.all(jobs);}catch(e){p.kill();if(process.env.BACKUP_ERROR_FILE)await writeFile(process.env.BACKUP_ERROR_FILE,Buffer.concat(errors),{mode:0o600});throw e;}}
export async function backup(){
 const u=new URL(process.env.ADMIN_DATABASE_URL||'');if(u.pathname!=='/satima_cms'||u.searchParams.get('sslmode')!=='verify-full')throw new Error('A verified-TLS satima_cms owner connection is required');
 const k=await key(),dir=resolve(process.env.BACKUP_DIR||'database/backups');await mkdir(dir,{recursive:true,mode:0o700});
 const name='neon_'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump.enc',file=resolve(dir,name),partial=file+'.partial',ca=resolve(dir,'.backup-ca-'+randomBytes(6).toString('hex')+'.pem');
 await writeFile(ca,rootCertificates.join('\n'),{mode:0o600,flag:'wx'});
 const vars={PGHOST:u.hostname,PGPORT:u.port||'5432',PGDATABASE:'satima_cms',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGSSLMODE:'verify-full',PGSSLROOTCERT:'/tmp/backup-ca.pem'};
 const args=['run','--rm','-i','--mount',`type=bind,source=${ca},destination=/tmp/backup-ca.pem,readonly`];for(const x of Object.keys(vars))args.push('-e',x);args.push('postgres:18.6','pg_dump','--format=custom','--no-owner','--no-acl');if(process.env.BACKUP_SNAPSHOT)args.push('--snapshot='+process.env.BACKUP_SNAPSHOT);
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',k,iv);cipher.setAAD(magic);
 try{
  await writeFile(partial,Buffer.concat([magic,iv]),{flag:'wx',mode:0o600});
  const output=createWriteStream(partial,{flags:'a',mode:0o600});const encrypted=pipeline(cipher,output);
  await Promise.all([run(args,{...process.env,...vars},null,cipher),encrypted]);
  const h=await open(partial,'a');try{await h.write(cipher.getAuthTag());await h.sync();}finally{await h.close();}
  await rename(partial,file);
  // Decrypt through EOF to authenticate the full archive, then inspect the archive format.
  await inspect(file);
  const hash=createHash('sha256');for await(const b of createReadStream(file))hash.update(b);
  await writeFile(file+'.sha256',hash.digest('hex')+'\n',{mode:0o600,flag:'wx'});
  console.log('Encrypted, authenticated backup verified: '+file);return file;
 }catch(e){await unlink(partial).catch(()=>{});throw e;}finally{await unlink(ca).catch(()=>{});}
}
async function decrypted(file){
 const size=(await stat(file)).size;if(size<37)throw new Error('Invalid encrypted backup');
 const h=await open(file,'r');const head=Buffer.alloc(20),tag=Buffer.alloc(16);try{await h.read(head,0,20,0);await h.read(tag,0,16,size-16);}finally{await h.close();}
 if(!head.subarray(0,8).equals(magic))throw new Error('Invalid backup header');
 const decipher=createDecipheriv('aes-256-gcm',await key(),head.subarray(8));decipher.setAAD(magic);decipher.setAuthTag(tag);
 return {source:createReadStream(file,{start:20,end:size-17}),decipher};
}
export async function inspect(file){
 const {source,decipher}=await decrypted(file);
 let prefix=Buffer.alloc(0),length=0;
 const sink=new Writable({write(chunk,_encoding,done){
  length+=chunk.length;
  if(prefix.length<5)prefix=Buffer.concat([prefix,chunk.subarray(0,5-prefix.length)]);
  done();
 }});
 await pipeline(source,decipher,sink); // Read through EOF to authenticate the GCM tag.
 if(length<5||prefix.toString()!=='PGDMP')throw new Error('Backup is not a PostgreSQL custom-format archive');
}
export async function restoreIsolated(file,target){
 if(!/^satima-restore-test-[a-f0-9]{8}$/.test(target||''))throw new Error('Restore is restricted to a named disposable local test container');
 const {source,decipher}=await decrypted(file);
 await Promise.all([pipeline(source,decipher),run(['exec','-i',target,'pg_restore','--username=postgres','--dbname=satima_restore','--no-owner','--no-acl','--single-transaction'],process.env,decipher,null)]);
 console.log('Isolated restore completed.');
}
if(process.argv[1]===new URL(import.meta.url).pathname){try{const action=process.argv[2]||'backup';if(action==='backup')await backup();else if(action==='verify')await inspect(process.argv[3]);else if(action==='restore-isolated')await restoreIsolated(process.argv[3],process.argv[4]);else throw new Error('Unknown backup operation');}catch(e){console.error('Backup operation failed:',e.message);process.exitCode=1;}}

import pg from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const admin=process.env.ADMIN_DATABASE_URL,password=process.env.APP_DB_PASSWORD;
if(!admin||!password||password.length<24)throw new Error('Hosted database credentials are required.');
if(new URL(admin).pathname!=='/satima_cms')throw new Error('Expected the satima_cms database.');
const c=new pg.Client({connectionString:admin,connectionTimeoutMillis:15000});
try {
 await c.connect();
 await c.query('SELECT pg_advisory_lock(728410022)');
 await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
 const dir=new URL('../../database/migrations/',import.meta.url);
 for(const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort()){
  const bytes=await readFile(new URL(name,dir)),checksum=createHash('sha256').update(bytes).digest('hex');
  const {rows:[applied]}=await c.query('SELECT checksum FROM schema_migrations WHERE version=$1',[name]);
  if(applied){if(applied.checksum!==checksum)throw new Error('Migration checksum mismatch: '+name);continue;}
  await c.query('BEGIN');
  try {await c.query(bytes.toString());await c.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[name,checksum]);await c.query('COMMIT');}
  catch(e){await c.query('ROLLBACK');throw e;}
  console.log('Applied '+name);
 }
 // Reapply existing grants after a private restore made with --no-acl.
 await c.query(await readFile(new URL('008_application_role.sql',dir),'utf8'));
 // Safe quoting; no password is written to a file or printed in deployment logs.
 await c.query('ALTER ROLE satima_app PASSWORD '+pg.escapeLiteral(password));
 await c.query('SELECT pg_advisory_unlock(728410022)');
 console.log('Database migrations and restricted app credential are ready.');
} catch(e){console.error('Database preparation failed:',e.code||e.name);process.exitCode=1;}
finally {await c.end();}

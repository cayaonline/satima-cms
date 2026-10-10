// Free Render hosting connects with only the restricted Neon app credential.
if(process.env.DATABASE_URL){
 const url=new URL(process.env.DATABASE_URL);
 if(url.pathname!=='/satima_cms'||decodeURIComponent(url.username)!=='satima_app')throw new Error('Expected the restricted satima_app connection to satima_cms.');
 if(!['localhost','127.0.0.1'].includes(url.hostname)&&url.searchParams.get('sslmode')!=='verify-full')throw new Error('Hosted database connection must verify TLS certificates.');
}else{
 const admin=process.env.ADMIN_DATABASE_URL,password=process.env.APP_DB_PASSWORD;
 if(!admin||!password||password.length<24)throw new Error('Hosted database credentials are required.');
 const url=new URL(admin);
 if(url.pathname!=='/satima_cms')throw new Error('Expected the satima_cms database.');
 url.username='satima_app';url.password=password;
 process.env.DATABASE_URL=url.toString();
}
process.env.LISTEN_HOST='0.0.0.0';
if(!process.env.PUBLIC_ORIGIN&&!process.env.RENDER_EXTERNAL_URL)throw new Error('Hosted public origin is required.');
delete process.env.ADMIN_DATABASE_URL;
delete process.env.APP_DB_PASSWORD;
await import('../server.mjs');

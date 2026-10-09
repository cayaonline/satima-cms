// Explicit HTTPS origin for hosted installs; localhost defaults remain unchanged.
export function requestPolicy(env=process.env) {
 const port=Number(env.PORT||3000),publicPort=env.CMS_PORT||String(port);
 const configured=env.PUBLIC_ORIGIN||(env.RENDER==='true'?env.RENDER_EXTERNAL_URL:null);
 if(env.RENDER==='true'&&!configured)throw new Error('Hosted public origin is required.');
 let origin=null;
 if(configured){
  const u=new URL(configured);
  if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('PUBLIC_ORIGIN must be an HTTPS origin.');
  origin=u.origin;
 }
 const hosts=origin?new Set([new URL(origin).host]):new Set([`127.0.0.1:${publicPort}`,`localhost:${publicPort}`,`127.0.0.1:${port}`]);
 return {port,secure:!!origin,hostAllowed:host=>hosts.has(host),writeAllowed:(host,supplied)=>hosts.has(host)&&supplied===(origin||'http://'+host)};
}

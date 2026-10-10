import {readFile,stat} from 'node:fs/promises';
import {backup} from './backup-hosted.mjs';
try{
 const path=process.env.BACKUP_CONFIG_FILE;if(!path)throw new Error('BACKUP_CONFIG_FILE is required');
 if((await stat(path)).mode&0o077)throw new Error('Backup configuration must be private (mode 0600)');
 const config=JSON.parse(await readFile(path,'utf8'));
 for(const key of ['ADMIN_DATABASE_URL','BACKUP_KEY_FILE','BACKUP_DIR','DOCKER'])if(config[key])process.env[key]=config[key];
 await backup();
}catch(e){console.error('Scheduled backup failed:',e.message);process.exitCode=1;}

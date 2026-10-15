import {createHash} from 'node:crypto';
import {Problem} from './store.mjs';

export const maxPhotographBytes=10*1024*1024;
const contentTypes=new Set(['image/jpeg','image/png','image/webp']);

export async function photographBody(req){
 const contentType=req.headers['content-type'];
 if(!contentTypes.has(contentType))throw new Problem(415,'Unsupported image format. Choose JPEG, PNG or WebP.');
 if(Number(req.headers['content-length'])>maxPhotographBytes)throw new Problem(413,'File exceeds the 10 MB upload limit.');
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>maxPhotographBytes)throw new Problem(413,'File exceeds the 10 MB upload limit.');chunks.push(chunk);}
 const bytes=Buffer.concat(chunks,size);
 const png=bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0;
 const jpeg=bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
 const webp=bytes.length>=16&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.readUInt32LE(4)===bytes.length-8&&bytes.toString('ascii',8,12)==='WEBP';
 if(!((contentType==='image/png'&&png)||(contentType==='image/jpeg'&&jpeg)||(contentType==='image/webp'&&webp)))throw new Problem(400,'The photograph file does not match its image type.');
 return {contentType,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
}

export async function readPhotograph(pool,id,registeredOnly=false){
 const {rows:[photo]}=await pool.query(`SELECT p.content_type,p.image_data FROM farmer_photographs p JOIN farmers f ON f.id=p.farmer_id WHERE p.farmer_id=$1${registeredOnly?" AND f.record_kind='registered'":''}`,[id]);
 if(!photo)throw new Problem(404,'Farmer photograph not found.');
 return photo;
}

export async function savePhotograph(c,id,photo){
 const farmer=await c.query('SELECT 1 FROM farmers WHERE id=$1 FOR UPDATE',[id]);
 if(!farmer.rowCount)throw new Problem(404,'Farmer not found.');
 await c.query(`INSERT INTO farmer_photographs(farmer_id,content_type,image_data,sha256) VALUES($1,$2,$3,$4)
  ON CONFLICT(farmer_id) DO UPDATE SET content_type=EXCLUDED.content_type,image_data=EXCLUDED.image_data,sha256=EXCLUDED.sha256,updated_at=clock_timestamp()`,[id,photo.contentType,photo.bytes,photo.sha256]);
}

export async function removePhotograph(c,id){
 const farmer=await c.query('SELECT 1 FROM farmers WHERE id=$1 FOR UPDATE',[id]);
 if(!farmer.rowCount)throw new Problem(404,'Farmer not found.');
 await c.query('DELETE FROM farmer_photographs WHERE farmer_id=$1',[id]);
}

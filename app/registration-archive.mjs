import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {pool,Problem,transaction} from './store.mjs';

const maxBytes=80*1024*1024;
const batchIdPattern=/^[A-Z0-9-]{3,40}$/;
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const statusValues=new Set(['unmatched','needs_review','matched','verified']);

export async function readPdfBody(req){
 if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/pdf')throw new Problem(415,'Choose a PDF file.');
 const size=Number(req.headers['content-length']);
 if(!Number.isSafeInteger(size)||size<1||size>maxBytes)throw new Problem(413,'PDF must be between 1 byte and 80 MB.');
 const chunks=[];let total=0;
 for await(const chunk of req){total+=chunk.length;if(total>maxBytes)throw new Problem(413,'PDF exceeds 80 MB.');chunks.push(chunk);}
 if(total!==size)throw new Problem(400,'Incomplete PDF upload.');
 const bytes=Buffer.concat(chunks,total);
 if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Problem(400,'File is not a PDF.');
 let pdf;try{pdf=await PDFDocument.load(bytes,{updateMetadata:false});}catch{throw new Problem(400,'PDF could not be read.');}
 if(pdf.getPageCount()<1||pdf.getPageCount()>500)throw new Problem(400,'PDF page count is outside the supported range.');
 return {bytes,pageCount:pdf.getPageCount(),checksum:sha(bytes)};
}

export function batchMetadata(headers){
 let name,filename;
 try{name=decodeURIComponent(headers['x-archive-batch-name']||'');filename=decodeURIComponent(headers['x-archive-filename']||'');}catch{throw new Problem(400,'Invalid archive metadata encoding.');}
 const id=headers['x-archive-batch-id'],expected=Number(headers['x-archive-expected-count']);
 if(typeof id!=='string'||!batchIdPattern.test(id)||typeof name!=='string'||name.trim().length<1||name.length>200||typeof filename!=='string'||filename.length<1||filename.length>200||!filename.toLowerCase().endsWith('.pdf')||/[\\/\x00-\x1f]/.test(filename)||!Number.isInteger(expected)||expected<1||expected>500)throw new Problem(400,'Enter a valid batch ID, name, PDF filename and expected count.');
 return {id,name:name.trim(),filename,expected};
}

export async function createArchiveBatch(meta,pdf){
 return transaction(async client=>{
  const {rows:[row]}=await client.query(`INSERT INTO registration_archive_batches(id,name,original_filename,sha256,pdf_data,page_count,expected_farmer_count,uploaded_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,'administrator') RETURNING id,name,original_filename,sha256,page_count,expected_farmer_count,document_status,archived_at`,
   [meta.id,meta.name,meta.filename,pdf.checksum,pdf.bytes,pdf.pageCount,meta.expected]);
  await client.query("INSERT INTO registration_archive_events(batch_id,actor_role,action) VALUES($1,'administrator','upload')",[meta.id]);
  return row;
 },'Registration archive upload');
}

export async function listArchiveBatches(){
 const {rows}=await pool.query(`SELECT b.id,b.name,b.original_filename,b.sha256,b.page_count,b.expected_farmer_count,b.document_status,b.archived_at,b.supersedes_batch_id,
  EXISTS(SELECT 1 FROM registration_archive_batches newer WHERE newer.supersedes_batch_id=b.id) AS superseded,
  count(e.id)::int AS identified_forms,count(e.id) FILTER(WHERE e.farmer_id IS NOT NULL AND e.verification_status IN ('matched','verified'))::int AS matched_forms,
  count(e.id) FILTER(WHERE e.farmer_id IS NULL)::int AS unassigned_forms
  FROM registration_archive_batches b LEFT JOIN registration_archive_entries e ON e.batch_id=b.id GROUP BY b.id ORDER BY b.archived_at DESC`);
 return rows;
}

export async function listArchiveEntries(batchId){
 const {rows}=await pool.query(`SELECT e.id,e.batch_id,e.farmer_id,e.page_start,e.page_end,e.verification_status,e.isolated_sha256,e.associated_at,e.updated_at,
  f.customer_id,f.full_name FROM registration_archive_entries e LEFT JOIN farmers f ON f.id=e.farmer_id WHERE e.batch_id=$1 ORDER BY e.page_start`,[batchId]);
 return rows;
}

function entryInput(value){
 const pageStart=Number(value.page_start),pageEnd=Number(value.page_end),farmerId=value.farmer_id||null,status=value.verification_status||(farmerId?'matched':'unmatched');
 if(!Number.isInteger(pageStart)||pageStart<1||!Number.isInteger(pageEnd)||pageEnd<pageStart||pageEnd-pageStart>19||farmerId&&!uuidPattern.test(farmerId)||!statusValues.has(status)||!farmerId&&!['unmatched','needs_review'].includes(status))throw new Problem(400,'Invalid page range, farmer or verification status.');
 return {pageStart,pageEnd,farmerId,status};
}
async function isolatedPdf(bytes,start,end){
 let source;try{source=bytes instanceof PDFDocument?bytes:await PDFDocument.load(bytes,{updateMetadata:false});}catch{throw new Problem(400,'Archived PDF is unreadable.');}
 const result=await PDFDocument.create();
 for(const page of await result.copyPages(source,Array.from({length:end-start+1},(_,index)=>start+index-1)))result.addPage(page);
 return Buffer.from(await result.save({useObjectStreams:false}));
}

// Used by the private, repeatable import command. A single transaction keeps
// the original and every reviewed page association consistent on first import.
export async function importArchiveBatch(meta,pdf,entries,existingClient=null){
 const source=await PDFDocument.load(pdf.bytes,{updateMetadata:false});
 if(source.getPageCount()!==pdf.pageCount)throw new Problem(400,'PDF page count changed.');
 const importWithClient=async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[meta.id]);
  const {rows:[existing]}=await client.query('SELECT id,sha256 FROM registration_archive_batches WHERE id=$1',[meta.id]);
  if(existing&&existing.sha256!==pdf.checksum)throw new Problem(409,'Batch ID already belongs to a different PDF.');
  if(!existing){
   await client.query(`INSERT INTO registration_archive_batches(id,name,original_filename,sha256,pdf_data,page_count,expected_farmer_count,uploaded_by,supersedes_batch_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,'administrator',$8)`,[meta.id,meta.name,meta.filename,pdf.checksum,pdf.bytes,pdf.pageCount,meta.expected,meta.supersedesBatchId||null]);
   await client.query("INSERT INTO registration_archive_events(batch_id,actor_role,action) VALUES($1,'administrator','upload')",[meta.id]);
  }
  let inserted=0,skipped=0;
  for(const entry of entries){
   const data=entryInput(entry);
   if(data.pageEnd>pdf.pageCount)throw new Problem(400,'Page range exceeds the source PDF.');
   const {rows:[prior]}=await client.query('SELECT farmer_id,verification_status,page_end FROM registration_archive_entries WHERE batch_id=$1 AND page_start=$2',[meta.id,data.pageStart]);
   if(prior){if(prior.page_end!==data.pageEnd||prior.farmer_id!==data.farmerId||prior.verification_status!==data.status)throw new Problem(409,'Existing page association differs from the reviewed import.');skipped++;continue;}
   const {rows:[overlap]}=await client.query('SELECT 1 FROM registration_archive_entries WHERE batch_id=$1 AND page_start<=$3 AND page_end>=$2 LIMIT 1',[meta.id,data.pageStart,data.pageEnd]);
   if(overlap)throw new Problem(409,'Page ranges overlap.');
   const slice=await isolatedPdf(source,data.pageStart,data.pageEnd);
   const {rows:[row]}=await client.query(`INSERT INTO registration_archive_entries(batch_id,farmer_id,page_start,page_end,verification_status,isolated_pdf,isolated_sha256,associated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,'administrator') RETURNING id`,[meta.id,data.farmerId,data.pageStart,data.pageEnd,data.status,slice,sha(slice)]);
   await client.query("INSERT INTO registration_archive_events(batch_id,entry_id,actor_role,action) VALUES($1,$2,'administrator','associate')",[meta.id,row.id]);
   inserted++;
  }
  return {inserted,skipped};
 };
 return existingClient?importWithClient(existingClient):transaction(importWithClient,'Registration archive import');
}

export async function saveArchiveEntry(batchId,input,entryId=null){
 if(!batchIdPattern.test(batchId)||entryId&&!uuidPattern.test(entryId))throw new Problem(400,'Invalid archive identifier.');
 const data=entryInput(input);
 return transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[batchId]);
  const {rows:[batch]}=await client.query('SELECT pdf_data,page_count FROM registration_archive_batches WHERE id=$1',[batchId]);
  if(!batch)throw new Problem(404,'Archive batch not found.');
  if(data.pageEnd>batch.page_count)throw new Problem(400,'Page range exceeds the batch PDF.');
  const {rows:[overlap]}=await client.query(`SELECT id FROM registration_archive_entries WHERE batch_id=$1 AND page_start<=$3 AND page_end>=$2 AND ($4::uuid IS NULL OR id<>$4) LIMIT 1`,[batchId,data.pageStart,data.pageEnd,entryId]);
  if(overlap)throw new Problem(409,'These pages are already assigned to an archive entry.');
  if(data.farmerId){const {rows:[farmer]}=await client.query("SELECT id FROM farmers WHERE id=$1 AND record_kind='registered'",[data.farmerId]);if(!farmer)throw new Problem(404,'Farmer not found.');}
  const slice=await isolatedPdf(batch.pdf_data,data.pageStart,data.pageEnd);
  let row;
  if(entryId){
   const result=await client.query(`UPDATE registration_archive_entries SET farmer_id=$3,page_start=$4,page_end=$5,verification_status=$6,
    isolated_pdf=$7,isolated_sha256=$8,associated_by='administrator',updated_at=now() WHERE id=$1 AND batch_id=$2
    RETURNING id,batch_id,farmer_id,page_start,page_end,verification_status,isolated_sha256,associated_at,updated_at`,
   [entryId,batchId,data.farmerId,data.pageStart,data.pageEnd,data.status,slice,sha(slice)]);row=result.rows[0];
   if(!row)throw new Problem(404,'Archive entry not found.');
  }else{
   const result=await client.query(`INSERT INTO registration_archive_entries(batch_id,farmer_id,page_start,page_end,verification_status,isolated_pdf,isolated_sha256,associated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,'administrator') RETURNING id,batch_id,farmer_id,page_start,page_end,verification_status,isolated_sha256,associated_at,updated_at`,
   [batchId,data.farmerId,data.pageStart,data.pageEnd,data.status,slice,sha(slice)]);row=result.rows[0];
  }
  await client.query("INSERT INTO registration_archive_events(batch_id,entry_id,actor_role,action) VALUES($1,$2,'administrator',$3)",[batchId,row.id,entryId?'reassociate':'associate']);
  return row;
 },'Registration archive association');
}

export async function farmerArchiveDocuments(farmerId,viewer=false){
 if(!uuidPattern.test(farmerId))throw new Problem(400,'Invalid farmer identifier.');
 const {rows}=await pool.query(`SELECT e.id,e.batch_id,e.page_start,e.page_end,e.verification_status,e.associated_at,
  b.name AS batch_name,b.original_filename,b.archived_at,b.document_status
  FROM registration_archive_entries e JOIN registration_archive_batches b ON b.id=e.batch_id
  WHERE e.farmer_id=$1 AND NOT EXISTS(SELECT 1 FROM registration_archive_batches newer WHERE newer.supersedes_batch_id=b.id)
  ${viewer?"AND e.verification_status IN ('matched','verified')":''} ORDER BY b.archived_at DESC,e.page_start`,[farmerId]);
 return rows;
}

export async function protectedPdf({farmerId,entryId,batchId,viewer=false,master=false,download=false}){
 if(master){
  if(viewer||!batchIdPattern.test(batchId))throw new Problem(403,'Archive access denied.');
  const {rows:[row]}=await pool.query('SELECT id,original_filename,pdf_data FROM registration_archive_batches WHERE id=$1',[batchId]);
  if(!row)throw new Problem(404,'Archive batch not found.');
  await pool.query("INSERT INTO registration_archive_events(batch_id,actor_role,action) VALUES($1,'administrator',$2)",[batchId,download?'download':'view']);
  return {bytes:row.pdf_data,filename:row.original_filename};
 }
 if(batchId&&!farmerId&&!viewer){
  if(!batchIdPattern.test(batchId)||!uuidPattern.test(entryId))throw new Problem(400,'Invalid archive entry.');
  const {rows:[row]}=await pool.query('SELECT isolated_pdf,page_start,page_end FROM registration_archive_entries WHERE batch_id=$1 AND id=$2',[batchId,entryId]);
  if(!row)throw new Problem(404,'Archive entry not found.');
  await pool.query("INSERT INTO registration_archive_events(batch_id,entry_id,actor_role,action) VALUES($1,$2,'administrator',$3)",[batchId,entryId,download?'download':'view']);
  return {bytes:row.isolated_pdf,filename:`${batchId}-pages-${row.page_start}-${row.page_end}.pdf`};
 }
 if(!uuidPattern.test(farmerId)||!uuidPattern.test(entryId))throw new Problem(400,'Invalid document identifier.');
 const {rows:[row]}=await pool.query(`SELECT e.batch_id,e.isolated_pdf,e.verification_status,f.customer_id FROM registration_archive_entries e
  JOIN farmers f ON f.id=e.farmer_id WHERE e.id=$1 AND e.farmer_id=$2 ${viewer?"AND e.verification_status IN ('matched','verified') AND f.record_kind='registered'":''}`,[entryId,farmerId]);
 if(!row)throw new Problem(404,'Registration document not found.');
 await pool.query('INSERT INTO registration_archive_events(batch_id,entry_id,actor_role,action) VALUES($1,$2,$3,$4)',[row.batch_id,entryId,viewer?'registration_viewer':'administrator',download?'download':'view']);
 return {bytes:row.isolated_pdf,filename:`${row.customer_id||'farmer'}-registration.pdf`};
}

// Private manifest format and workflow: docs/registration-archives.md.
// Dry run by default. --apply never creates or changes farmer records.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {pool} from '../store.mjs';
import {importArchiveBatch} from '../registration-archive.mjs';

const manifestPath=process.argv[2],apply=process.argv.includes('--apply');
if(!manifestPath)throw new Error('Pass a private archive manifest path.');
const normalizeName=value=>String(value||'').toLowerCase().replace(/[^a-z]/g,'');
const digits=value=>String(value||'').replace(/\D/g,'');
const phone=value=>digits(value).slice(-9);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 const bytes=await readFile(manifest.document_path),checksum=hash(bytes);
 if(checksum!==manifest.sha256)throw new Error('Source PDF checksum does not match the private manifest.');
 const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
 const count=pdf.getPageCount();
 if(!Array.isArray(manifest.forms)||!manifest.forms.length)throw new Error('Manifest has no forms.');
 const {rows:farmers}=await pool.query("SELECT id,customer_id,full_name,national_id,primary_phone FROM farmers WHERE record_kind='registered'");
 const {rows:existingSources}=await pool.query('SELECT s.document_name,s.first_page,s.last_page,f.id,f.customer_id FROM farmer_registration_sources s JOIN farmers f ON f.id=s.farmer_id');
 const report={batch_id:manifest.batch_id,expected_farmers:manifest.expected_farmer_count,identified_forms:manifest.forms.length,pdf_pages:count,matched:0,unmatched:0,ambiguous:0,duplicate_candidates:0,missing_or_illegible:0,review_pages:[],extra_forms:Math.max(0,manifest.forms.length-manifest.expected_farmer_count)};
 const entries=[],seenPages=new Set(),seenFarmers=new Set();
 for(const form of manifest.forms){
  const start=form.page_start,end=form.page_end;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>count||end-start>19)throw new Error('Invalid page span in private manifest.');
  for(let page=start;page<=end;page++){if(seenPages.has(page))throw new Error('Overlapping page ranges in private manifest.');seenPages.add(page);}
  const observed=form.observed||{},id=digits(observed.national_id),number=phone(observed.primary_phone),name=normalizeName(observed.full_name);
  const byId=id?farmers.filter(farmer=>digits(farmer.national_id)===id):[];
  const byPhone=number?farmers.filter(farmer=>phone(farmer.primary_phone)===number):[];
  const byName=name?farmers.filter(farmer=>normalizeName(farmer.full_name)===name):[];
  const source=form.existing_source;
  const bySource=source?existingSources.filter(item=>item.document_name===source.document_name&&item.first_page===source.first_page&&item.last_page===source.last_page):[];
  let candidate=bySource.length===1?farmers.find(item=>item.id===bySource[0].id):null,ambiguous=bySource.length>1;
  if(byId.length===1){if(candidate&&candidate.id!==byId[0].id)ambiguous=true;else candidate=byId[0];}else if(byId.length>1)ambiguous=true;
  if(byPhone.length===1){if(candidate&&candidate.id!==byPhone[0].id)ambiguous=true;else if(!candidate)candidate=byPhone[0];}
  else if(byPhone.length>1)ambiguous=true;
  if(!candidate&&!ambiguous&&byName.length===1&&form.expected_customer_id===byName[0].customer_id)candidate=byName[0];
  if(candidate&&form.expected_customer_id&&candidate.customer_id!==form.expected_customer_id)ambiguous=true;
  if(candidate&&seenFarmers.has(candidate.id)){ambiguous=true;report.duplicate_candidates++;}
  if(form.hold_for_review){ambiguous=true;candidate=null;}
  if(ambiguous){report.ambiguous++;report.review_pages.push(start);candidate=null;}
  else if(candidate){report.matched++;seenFarmers.add(candidate.id);}
  else if(!name||!id&&!number){report.missing_or_illegible++;report.review_pages.push(start);}
  else{report.unmatched++;report.review_pages.push(start);}
  entries.push({page_start:start,page_end:end,farmer_id:candidate?.id||null,verification_status:candidate?'matched':ambiguous?'needs_review':'unmatched'});
 }
 report.uncovered_pages=Array.from({length:count},(_,index)=>index+1).filter(page=>!seenPages.has(page));
 if(report.uncovered_pages.length)throw new Error('Some PDF pages are not accounted for by the manifest.');
 if(apply){
  if(!process.env.DATABASE_URL)throw new Error('A restricted database connection is required for --apply.');
  report.import=await importArchiveBatch({id:manifest.batch_id,name:manifest.batch_name,filename:manifest.original_filename,expected:manifest.expected_farmer_count},{bytes,pageCount:count,checksum},entries);
 }
 const reportPath=process.env.ARCHIVE_REPORT_PATH;
 if(reportPath)await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(report));
}catch(error){console.error('Registration archive import failed:',error.code||error.name||'error');process.exitCode=1;}
finally{await pool.end();}

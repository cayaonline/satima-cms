import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRows,normalizedPhone,planSync} from '../scripts/master-sync-core.mjs';

test('Kenyan phone forms normalize to one identity',()=>{
 assert.equal(normalizedPhone('0712 345 678'),'+254712345678');
 assert.equal(normalizedPhone('+254 712 345 678'),'+254712345678');
 assert.equal(normalizedPhone('0112 345 678'),'+254112345678');
 assert.equal(normalizedPhone('unknown'),null);
});
test('Excel-style headers map to the existing customer fields without guessing extra columns',()=>{
 const [row]=canonicalRows('customers',[{source_row:2,NAME:'Example Person',ADDRESS:'Example Place','PHONE. NO':'0712345678',Neigborhood:'Unmapped source detail'}]);
 assert.equal(row.full_name,'Example Person');assert.equal(row.physical_address,'Example Place');assert.equal(row.phone_number,'0712345678');assert.equal(row.category,undefined);
});
test('only deterministic matches update; blanks preserve existing values',()=>{
 const existing=[{id:'one',customer_id:'C0001',full_name:'Example Person',phone_number:'0712345678',physical_address:'Old',category:'Current Customers'}];
 const plan=planSync('customers',[{source_row:2,full_name:' EXAMPLE   PERSON ',phone_number:'+254712345678',physical_address:'New',category:''}],existing);
 assert.equal(plan[0].result,'updated');
 assert.equal(plan[0].record_id,'one');
 assert.equal(plan[0].changes.category,undefined);
 assert.equal(plan[0].changes.physical_address.to,'New');
});
test('ambiguous names and phones stay in review and repeated rows do not add duplicates',()=>{
 const existing=[{id:'one',customer_id:'C0001',full_name:'Example Person',phone_number:'0712345678'}];
 const plan=planSync('customers',[
  {source_row:2,full_name:'Example Person',phone_number:'0712000000'},
  {source_row:3,full_name:'New Person',phone_number:'0112345678'},
  {source_row:4,full_name:'New Person',phone_number:'0112345678'}
 ],existing);
 assert.deepEqual(plan.map(row=>row.result),['review','added','review']);
});
test('stable IDs never override a conflicting person',()=>{
 const existing=[{id:'one',customer_id:'C0001',full_name:'Example Person',phone_number:'0712345678'}];
 const plan=planSync('customers',[{source_row:2,customer_id:'C0001',full_name:'Another Person',phone_number:'0112345678'}],existing);
 assert.equal(plan[0].result,'review');
});

test('private Excel reader handles shared strings and column gaps',async t=>{
 const {spawnSync}=await import('node:child_process');
 if(spawnSync('python3',['--version'],{stdio:'ignore'}).status!==0){t.skip('Python 3 is unavailable');return;}
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'satima-xlsx-'));
 try{
  const path=join(directory,'fixture.xlsx');
  const py=`import zipfile,sys\np=sys.argv[1]\nwith zipfile.ZipFile(p,'w') as z:\n z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>')\n z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>')\n z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2" t="inlineStr"><is><t>0712345678</t></is></c></row></sheetData></worksheet>')\n z.writestr('xl/sharedStrings.xml','<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>NAME</t></si><si><t>PHONE. NO</t></si><si><t>Example Person</t></si></sst>')`;
  assert.equal(spawnSync('python3',['-c',py,path]).status,0);
  const parsed=spawnSync('python3',[new URL('../scripts/xlsx-rows.py',import.meta.url).pathname,path],{encoding:'utf8'});
  assert.equal(parsed.status,0,parsed.stderr);
  const rows=canonicalRows('customers',JSON.parse(parsed.stdout));
  assert.equal(rows[0].full_name,'Example Person');assert.equal(rows[0].phone_number,'0712345678');
 }finally{await rm(directory,{recursive:true,force:true});}
});

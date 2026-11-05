import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('red-fill extraction preserves cell evidence and refuses conditional formatting',()=>{
 const script=fileURLToPath(new URL('../scripts/read-collections-flags.py',import.meta.url));
 const result=spawnSync('python3',['-c',`
import importlib.util,tempfile,zipfile,json,sys
spec=importlib.util.spec_from_file_location('flags',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
styles=f'<styleSheet xmlns="{ns}"><fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill></fills><cellXfs><xf fillId="0"/><xf fillId="1"/></cellXfs></styleSheet>'
with tempfile.TemporaryDirectory() as d:
 p=d+'/synthetic.xlsx'
 for conditional in [False,True]:
  sheet=f'<worksheet xmlns="{ns}"><sheetData><row r="2"><c r="A2" s="1"/><c r="B2" s="1"/></row><row r="3"><c r="A3"/></row></sheetData>'+('<conditionalFormatting/>' if conditional else '')+'</worksheet>'
  with zipfile.ZipFile(p,'w') as z:z.writestr('xl/styles.xml',styles);z.writestr('xl/worksheets/sheet1.xml',sheet)
  if conditional:
   try:m.extract_flags(p);raise AssertionError('conditional fill accepted')
   except ValueError:pass
  else:
   flags=m.extract_flags(p);assert list(flags)==[2];assert [e['cell'] for e in flags[2]]==['A2','B2'];assert flags[2][0]['rgb']=='FFFF0000'
print('PASS')
`,script],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PASS/);
});

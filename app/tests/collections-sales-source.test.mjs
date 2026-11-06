import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('sales extractor recalculates mixed channels, preserves unknowns and rejects source inconsistencies',()=>{
 const script=String.raw`
import importlib.util, tempfile, zipfile, xml.etree.ElementTree as E
from pathlib import Path
spec=importlib.util.spec_from_file_location('sales', '${fileURLToPath(new URL('../scripts/read-october-invoices.py',import.meta.url))}')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
def fixture(path, bad=False, formula=False, distributor='Naivas'):
 strings=['customer_name','bcy_total','Sample Home','Total Homes','STORES',distributor,'Total Stores','Grand Total']
 values={'A1':('s','0'),'B1':('s','1'),'A2':('s','2'),'B2':('n','10.25'),'A3':('s','2'),'B3':('n','20.50'),'A4':('s','3'),'B4':('n','30.75'),'A6':('s','4'),'A7':('s','5'),'B7':('n','50'),'A8':('s','6'),'B8':('n','50'),'A9':('s','7'),'B9':('n','80.76' if bad else '80.75')}
 root=E.Element('worksheet',xmlns=ns);data=E.SubElement(root,'sheetData')
 formulas={'B4':'SUM(B2:B3)','B8':'SUM(B7:B7)','B9':'B4+B8' if not formula else 'B4-B8'}
 for ref,(kind,value) in values.items():
  row=E.SubElement(data,'row',r=ref[1:]);c=E.SubElement(row,'c',r=ref,t=kind)
  if ref in formulas:E.SubElement(c,'f').text=formulas[ref]
  E.SubElement(c,'v').text=value
 ss=E.Element('sst',xmlns=ns)
 for s in strings:E.SubElement(E.SubElement(ss,'si'),'t').text=s
 with zipfile.ZipFile(path,'w') as z:
  z.writestr('xl/workbook.xml','<workbook xmlns="'+ns+'"><sheets><sheet name="Invoice Details"/></sheets></workbook>')
  z.writestr('xl/sharedStrings.xml',E.tostring(ss));z.writestr('xl/worksheets/sheet1.xml',E.tostring(root))
with tempfile.TemporaryDirectory() as d:
 path=Path(d)/'source.xlsx';fixture(path);data=m.extract(path)
 assert data['summary']['homeInvoiced']==30.75 and data['summary']['storesInvoiced']==50 and data['summary']['totalInvoiced']==80.75
 assert data['summary']['distinctSourceNames']==1 and len(data['homes'])==2
 assert all(r['paymentStatus'] is None and r['invoiceDate'] is None and r['dueDate'] is None for r in data['homes'])
 assert data['stores'][0]['code']=='naivas' and data['homes'][0]['sourceReference']=='Invoice Details!A2:B2'
 for options in [{'bad':True},{'formula':True},{'distributor':'Unmapped Retailer'}]:
  fixture(path,**options)
  try:m.extract(path)
  except ValueError:pass
  else:raise AssertionError('Invalid source accepted')
print('validated')
`;
 assert.match(execFileSync('python3',['-c',script],{encoding:'utf8'}),/validated/);
});

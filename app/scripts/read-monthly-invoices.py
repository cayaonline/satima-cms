#!/usr/bin/env python3
"""Read a converted monthly invoice workbook and retain its source row references."""
from decimal import Decimal
import json, re, sys, zipfile, xml.etree.ElementTree as ET

NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
DISTRIBUTORS={'Chandarana':('chandarana','Chandarana'),'Naivas':('naivas','Naivas'),'KPS':('karen_provision_stores','Karen Provision Stores'),'OTW':('on_the_way','On The Way'),'Cleanshelf':('cleanshelf','Cleanshelf Supermarket')}

def extract(path, period):
 with zipfile.ZipFile(path) as z:
  wb=ET.fromstring(z.read('xl/workbook.xml')); rel=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
  targets={x.get('Id'):x.get('Target') for x in rel}; sheets=wb.find('s:sheets',NS)
  if len(sheets)!=1 or sheets[0].get('name')!='Invoice Details': raise ValueError('Unexpected invoice worksheet')
  target=targets[sheets[0].get('{%s}id'%NS['r'])].lstrip('/')
  if not target.startswith('xl/'): target='xl/'+target
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   strings=[''.join(t.itertext()) for t in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',NS)]
  cells={}
  for c in ET.fromstring(z.read(target)).findall('.//s:sheetData/s:row/s:c',NS):
   v=c.find('s:v',NS); value=v.text if v is not None else None
   if c.get('t')=='s' and value is not None: value=strings[int(value)]
   formula=c.find('s:f',NS)
   cells[c.get('r')]={'value':value,'formula':formula.text if formula is not None else None}
 val=lambda ref: cells.get(ref,{}).get('value')
 if [val('A1'),val('B1')]!=['customer_name','bcy_total']: raise ValueError('Unexpected report columns')
 def row_for(labels):
  matches=[int(re.search(r'\d+',ref).group()) for ref,d in cells.items() if ref.startswith('A') and (d.get('value') or '').strip().casefold() in labels]
  if len(matches)!=1: raise ValueError('Expected exactly one section total')
  return matches[0]
 home_end=row_for({'total homes','home total'})
 stores_header=row_for({'stores'})
 stores_start=stores_header+1
 stores_end=row_for({'total stores','stores total'})
 grand=stores_end+1
 def amount(ref):
  raw=val(ref)
  if raw is None or raw=='': raise ValueError('Missing source amount')
  value=Decimal(raw.replace(',','').strip())
  if not value.is_finite() or value<0 or value!=value.quantize(Decimal('.01')): raise ValueError('Invalid amount')
  return value
 def record(n,channel):
  name=val(f'A{n}')
  if not name: raise ValueError('Missing source name')
  item={'row':n,'name':name,'amount':float(amount(f'B{n}')),'channel':channel,'sourceReference':f'Invoice Details!A{n}:B{n}','raw':{c:cells[f'{c}{n}'] for c in 'AB'},'invoiceDate':None,'dueDate':None,'paymentStatus':None}
  return item
 homes=[record(n,'home_customers') for n in range(2,home_end)]
 if len(homes)!=home_end-2: raise ValueError('Home customer rows are incomplete')
 stores=[]
 for n in range(stores_start,stores_end):
  item=record(n,'distributors_stores')
  if item['name'] not in DISTRIBUTORS: raise ValueError('Unknown distributor label; mapping requires review')
  item['code'],item['displayName']=DISTRIBUTORS[item['name']];stores.append(item)
 if len(stores)!=5 or len({x['code'] for x in stores})!=len(stores): raise ValueError('Distributor summary rows are incomplete')
 formulas={ref:d['formula'] for ref,d in cells.items() if d.get('formula')}
 expected={f'B{home_end}':f'SUM(B2:B{home_end-1})',f'B{stores_end}':f'SUM(B{stores_start}:B{stores_end-1})',f'B{grand}':f'B{stores_end}+B{home_end}'}
 if formulas!=expected or val(f'A{grand}')!='Grand Total': raise ValueError('Unexpected workbook formulas or grand total row')
 total=lambda rows:sum((Decimal(str(r['amount'])) for r in rows),Decimal(0))
 h,s=total(homes),total(stores)
 if [h,s,h+s]!=[amount(f'B{x}') for x in [home_end,stores_end,grand]]: raise ValueError('Source rows do not reconcile to displayed totals')
 return {'sheet':'Invoice Details','homes':homes,'stores':stores,'summary':{'homeInvoiceRows':len(homes),'distinctSourceNames':len({r['name'] for r in homes}),'homeInvoiced':float(h),'storesInvoiced':float(s),'totalInvoiced':float(h+s),'distributorCount':len(stores)},'period':period,'periodBasis':'Month and year follow the supplied July, August, September workbook filenames and the October 2026 reporting sequence; individual invoice dates are absent.','sourceCells':cells}

if __name__=='__main__':
 try:
  if len(sys.argv)!=3 or not re.fullmatch(r'2026-(07|08|09)',sys.argv[2]): raise ValueError('Expected workbook path and 2026-07, 2026-08, or 2026-09')
  print(json.dumps(extract(sys.argv[1],sys.argv[2])))
 except Exception: sys.exit('Monthly invoice validation failed; inspect source privately.')

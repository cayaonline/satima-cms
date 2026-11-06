#!/usr/bin/env python3
"""Extract the accountant's sales report without inventing invoice dates or payments."""
import collections
from decimal import Decimal
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
DISTRIBUTORS={'Chandarana':('chandarana','Chandarana'),'Naivas':('naivas','Naivas'),'KPS':('karen_provision_stores','Karen Provision Stores'),'OTW':('on_the_way','On The Way'),'Cleanshelf':('cleanshelf','Cleanshelf Supermarket')}
def extract(path):
 with zipfile.ZipFile(path) as z:
  sheets=ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets',NS)
  if len(sheets)!=1 or sheets[0].get('name')!='Invoice Details':raise ValueError('Unexpected report sheet')
  strings=[''.join(t.itertext()) for t in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',NS)]
  cells={}
  for c in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//s:sheetData/s:row/s:c',NS):
   v=c.find('s:v',NS);v=v.text if v is not None else None
   if c.get('t')=='s' and v is not None:v=strings[int(v)]
   f=c.find('s:f',NS)
   cells[c.get('r')]={'value':v,'type':c.get('t'),'formula':f.text if f is not None else None}
 val=lambda c:cells.get(c,{}).get('value')
 if [val('A1'),val('B1')]!=['customer_name','bcy_total']:raise ValueError('Unexpected columns')
 def amount(c):
  value=Decimal(val(c).strip().replace(',',''))
  if not value.is_finite() or value<0 or value!=value.quantize(Decimal('.01')):raise ValueError('Invalid amount')
  return value
 home_end=next(int(re.sub(r'\D','',c)) for c in cells if c.startswith('A') and val(c)=='Total Homes')
 stores_start=next(int(re.sub(r'\D','',c)) for c in cells if c.startswith('A') and val(c)=='STORES')+1
 stores_end=next(int(re.sub(r'\D','',c)) for c in cells if c.startswith('A') and val(c)=='Total Stores')
 grand=stores_end+1
 expected={f'B{home_end}':f'SUM(B2:B{home_end-1})',f'B{stores_end}':f'SUM(B{stores_start}:B{stores_end-1})',f'B{grand}':f'B{home_end}+B{stores_end}'}
 formulas={c:d['formula'] for c,d in cells.items() if d['formula']}
 if formulas!=expected or val('A'+str(grand))!='Grand Total':raise ValueError('Unexpected summary formulas')
 def record(row,channel):
  if not val('A'+str(row)):raise ValueError('Missing source name')
  return {'row':row,'name':val('A'+str(row)),'amount':float(amount('B'+str(row))),'channel':channel,'sourceReference':f'Invoice Details!A{row}:B{row}','raw':{c:cells[c+str(row)] for c in 'AB'},'invoiceDate':None,'dueDate':None,'paymentStatus':None}
 homes=[record(r,'home_customers') for r in range(2,home_end)]
 stores=[]
 for row in range(stores_start,stores_end):
  r=record(row,'distributors_stores')
  if r['name'] not in DISTRIBUTORS:raise ValueError('Distributor mapping requires review')
  r['code'],r['displayName']=DISTRIBUTORS[r['name']];stores.append(r)
 if len({r['code'] for r in stores})!=len(stores):raise ValueError('Repeated distributor summary')
 total=lambda rows:sum((Decimal(str(r['amount'])) for r in rows),Decimal(0))
 home_total,store_total=total(homes),total(stores)
 if [home_total,store_total,home_total+store_total]!=[amount(f'B{r}') for r in [home_end,stores_end,grand]]:raise ValueError('Summary does not reconcile')
 return {'sheet':'Invoice Details','homes':homes,'stores':stores,'summary':{'homeInvoiceRows':len(homes),'distinctSourceNames':len({r['name'] for r in homes}),'homeInvoiced':float(home_total),'storesInvoiced':float(store_total),'totalInvoiced':float(home_total+store_total),'distributorCount':len(stores)},'sourceCells':cells,'period':'2026-10','periodBasis':'October sales report supplied by owner with accountant email context; individual invoice dates are not provided.'}
if __name__=='__main__':
 try:print(json.dumps(extract(sys.argv[1])))
 except Exception:sys.exit('October sales validation failed; inspect source privately.')

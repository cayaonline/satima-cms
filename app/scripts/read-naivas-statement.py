#!/usr/bin/env python3
"""Read-only statement extraction. Preserve raw cells and flag, never repair, anomalies."""
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def date_value(value, date1904=False):
    if re.fullmatch(r'\d+(?:\.0+)?', value):
        serial = Decimal(value)
        if not date1904 and serial == 60:
            raise ValueError('Invalid Excel leap day')
        epoch = datetime(1904, 1, 1) if date1904 else datetime(1899, 12, 31) if serial < 60 else datetime(1899, 12, 30)
        return (epoch + timedelta(days=int(serial))).date().isoformat()
    return datetime.strptime(value.strip(), '%d/%m/%Y').date().isoformat()

def money(value):
    amount = Decimal(re.sub(r'^KES\s*', '', value.strip()).replace(',', ''))
    if not amount.is_finite() or amount < 0 or amount != amount.quantize(Decimal('.01')):
        raise ValueError('Invalid statement amount')
    return amount

def analyze(cells, sheet, date1904=False):
    val = lambda ref: cells.get(ref, {}).get('value')
    header = val('A1') or ''
    period = re.search(r'From (\d{2}/\d{2}/\d{4}) To (\d{2}/\d{2}/\d{4})', header)
    if 'Naivas HQ' not in header or not period:
        raise ValueError('Expected Naivas customer statement')
    start, end = map(date_value, period.groups())
    if start > end or [val(c+'8') for c in 'ABCDEF'] != ['Date', 'Store', 'PO#', 'Transactions', 'Details', 'Amount']:
        raise ValueError('Unexpected statement structure')
    if [val('A'+str(i)) for i in (3,4,5)] != ['Invoiced Amount', 'Amount Paid', 'Balance Due']:
        raise ValueError('Expected statement controls')
    controls = dict(zip(['invoiced','paid','balance'], [float(money(val('D'+str(i)))) for i in (3,4,5)]))
    rows = sorted({int(re.sub(r'\D', '', ref)) for ref, c in cells.items() if int(re.sub(r'\D', '', ref)) >= 9 and c['value'] not in [None,'']})
    records, exceptions = [], []
    def flag(code, rownums, description):
        exceptions.append({'code':code,'rows':rownums,'description':description,'sourceReference':sheet+'!'+','.join(str(r) for r in rownums)})
    for row in rows:
        raw = {c:cells.get(c+str(row), {'value':None,'type':None,'formula':None,'style':None}) for c in 'ABCDEF'}
        values = [raw[c]['value'] for c in 'ABCDEF']
        if any(v is None or v == '' for v in values) or values[3] != 'Invoice':
            raise ValueError('Unexpected/incomplete statement transaction')
        day, store, po, kind, details, amount = values
        match = re.fullmatch(r'\s*(\S+)\s*-\s*due on (\d{2}/\d{2}/\d{4})\s*', details)
        if not match:
            raise ValueError('Unrecognized invoice reference/due date')
        reference, due = match.groups()
        invoice_date, due_date = date_value(day,date1904), date_value(due)
        records.append({'row':row,'branch':store,'purchaseOrder':po,'invoice':reference,'date':invoice_date,'dueDate':due_date,'amount':float(money(amount)),'raw':raw,'sourceReference':f'{sheet}!A{row}:F{row}'})
        if not start <= invoice_date <= end:
            flag('invoice_date_outside_period',[row],f'Source invoice date {invoice_date} falls outside the statement period. Preserved without correction.')
        if due_date < invoice_date:
            flag('due_before_invoice',[row],'Source due date precedes the source invoice date. Confirm both dates against the invoice.')
        if due_date[:4] != end[:4]:
            flag('due_year_differs',[row],f'Source due date {due_date} has a different year from the statement end. Confirm the payment terms; no date correction applied.')
        if not re.fullmatch(r'INV\d+',reference):
            flag('invoice_reference_format',[row],'Invoice reference differs from the usual INV followed by digits. Original reference preserved.')
        if po != po.strip():
            flag('purchase_order_whitespace',[row],'Purchase-order reference contains surrounding whitespace. Original characters retained for matching review.')
    refs = defaultdict(list)
    for record in records:
        refs[record['invoice']].append(record['row'])
    for ref, repeated in refs.items():
        if len(repeated)>1:
            flag('repeated_invoice_reference',repeated,'Invoice reference appears on multiple statement rows. Different purchase orders may explain it; all rows remain included pending review.')
    total = sum((Decimal(str(r['amount'])) for r in records),Decimal(0))
    within = sum((Decimal(str(r['amount'])) for r in records if start<=r['date']<=end),Decimal(0))
    if total != Decimal(str(controls['invoiced'])):
        flag('statement_total_difference',[3], 'Statement invoice summary differs from the sum of transaction rows.')
    if Decimal(str(controls['invoiced']))-Decimal(str(controls['paid'])) != Decimal(str(controls['balance'])):
        flag('statement_balance_difference',[3,4,5], 'Statement balance differs from invoiced less statement-reported paid.')
    for record in records:
        record['flags'] = [e['code'] for e in exceptions if record['row'] in e['rows']]
    return {'sheet':sheet,'title':header,'periodStart':start,'periodEnd':end,'controls':controls,'records':records,'exceptions':exceptions,
      'summary':{'invoiceRows':len(records),'branches':len({r['branch'] for r in records}),'listedInvoices':float(total),'datedWithinPeriod':float(within),'datedOutsidePeriod':float(total-within),'outsidePeriodRows':sum(not start<=r['date']<=end for r in records),'summaryDifference':float(total-Decimal(str(controls['invoiced']))),'exceptionCount':len(exceptions)},'sourceCells':cells}

def extract(path):
    with zipfile.ZipFile(path) as archive:
        wb = ET.fromstring(archive.read('xl/workbook.xml'))
        sheets = wb.find('s:sheets',NS)
        if len(sheets)!=1:
            raise ValueError('Expected a single statement sheet')
        prop=wb.find('s:workbookPr',NS)
        date1904=prop is not None and prop.get('date1904') in ['1','true']
        rels = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        rid = sheets[0].get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        target=next(r.get('Target') for r in rels if r.get('Id')==rid)
        target=target.lstrip('/') if target.startswith('/') else 'xl/'+target
        strings=[''.join(t.itertext()) for t in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si',NS)] if 'xl/sharedStrings.xml' in archive.namelist() else []
        cells={}
        for cell in ET.fromstring(archive.read(target)).findall('.//s:sheetData/s:row/s:c',NS):
            value, formula=cell.find('s:v',NS),cell.find('s:f',NS)
            if formula is not None:
                raise ValueError('Statement formulas require independent calculation review')
            value=value.text if value is not None else None
            if cell.get('t')=='s' and value is not None:value=strings[int(value)]
            if cell.get('t')=='inlineStr':value=''.join(cell.find('s:is',NS).itertext())
            if cell.get('t')=='e':raise ValueError('Workbook contains cell error')
            cells[cell.get('r')]={'value':value,'type':cell.get('t'),'formula':None,'style':cell.get('s')}
    return analyze(cells,sheets[0].get('name'),date1904)

if __name__=='__main__':
    try:print(json.dumps(extract(sys.argv[1])))
    except Exception:sys.exit('Naivas statement validation failed; inspect the original privately.')

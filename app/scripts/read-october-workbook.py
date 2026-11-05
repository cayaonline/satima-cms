#!/usr/bin/env python3
"""Read-only, dependency-free October XLSX extraction. JSON stdout is private IPC."""
import collections
from decimal import Decimal
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def extract(path):
    with zipfile.ZipFile(path) as archive:
        sheets = ET.fromstring(archive.read('xl/workbook.xml')).find('s:sheets', NS)
        if len(sheets) != 1 or sheets[0].get('name') != 'AR Aging Summary By Invoice Due':
            raise ValueError('Expected the supplied October worksheet')
        strings = [''.join(t.itertext()) for t in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        cells = {}
        for cell in ET.fromstring(archive.read('xl/worksheets/sheet1.xml')).findall('.//s:sheetData/s:row/s:c', NS):
            value, formula = cell.find('s:v', NS), cell.find('s:f', NS)
            value = value.text if value is not None else None
            if cell.get('t') == 's' and value is not None:
                value = strings[int(value)]
            cells[cell.get('r')] = {'value': value, 'type': cell.get('t'), 'formula': formula.text if formula is not None else None}
    if [cells[f'{c}1']['value'] for c in 'ABC'] != ['Customer Name', 'Total', 'Status']:
        raise ValueError('Unexpected source columns')
    records = []
    for row in sorted({int(re.sub(r'\D', '', ref)) for ref in cells}):
        if row == 1:
            continue
        raw = [cells.get(f'{c}{row}', {}).get('value') for c in 'ABC']
        if not raw[0] or cells.get(f'A{row}', {}).get('formula'):
            continue
        if not raw[1] or not raw[2]:
            raise ValueError(f'Incomplete account at row {row}')
        amount_text = re.sub(r'^(?:KES\s*)?', '', raw[1].strip()).replace(',', '').strip()
        amount = Decimal(amount_text)
        status = raw[2]
        if status == 'Paid':
            group, payment = 'Paid', amount
        elif status == 'Not Paid':
            group, payment = 'Unpaid', Decimal(0)
        elif re.fullmatch(r'Paid [\d,]+(?:\.\d+)?', status):
            group, payment = 'Partial', Decimal(status[5:].replace(',', ''))
        else:
            raise ValueError(f'Unrecognized source status at row {row}')
        records.append({'row': row, 'name': raw[0], 'amount': float(amount), 'status': status,
                        'group': group, 'payment': float(payment), 'balance': float(amount-payment),
                        'textAmount': cells[f'B{row}']['type'] == 's',
                        'source': {'sheet': sheets[0].get('name'), 'cells': f'A{row}:C{row}', 'raw': raw}})
    total = lambda rows, field: float(sum((Decimal(str(r[field])) for r in rows), Decimal(0)))
    paid = [r for r in records if r['group'] == 'Paid']
    unpaid = [r for r in records if r['group'] == 'Unpaid']
    partial = [r for r in records if r['group'] == 'Partial']
    formula_cells = {ref: value for ref, value in cells.items() if value['formula']}
    if len(formula_cells) != 1:
        raise ValueError('Expected one reconciliation formula')
    ref, formula = next(iter(formula_cells.items()))
    expected_formula = f'SUMIF(C2:C{records[-1]["row"]},"paid",B2:B{records[-1]["row"]})'
    if formula['formula'] != expected_formula:
        raise ValueError('Unexpected reconciliation formula; manual review required')
    numeric_paid = total([r for r in paid if not r['textAmount']], 'amount')
    summary = {'accounts': len(records), 'paidCount': len(paid), 'unpaidCount': len(unpaid),
               'partialCount': len(partial), 'listed': total(records, 'amount'),
               'paidLabelled': total(paid, 'amount'), 'unpaidLabelled': total(unpaid, 'amount'),
               'partialListed': total(partial, 'amount'), 'conditionalPayments': total(records, 'payment'),
               'conditionalOutstanding': total(records, 'balance'), 'textAmounts': sum(r['textAmount'] for r in records),
               'formulaCell': ref, 'formula': formula['formula'], 'formulaCached': float(formula['value']),
               'formulaRecalculated': numeric_paid,
               'formulaOmission': total([r for r in paid if r['textAmount']], 'amount')}
    return {'records': records, 'summary': summary, 'sourceCells': cells, 'sheet': sheets[0].get('name')}

if __name__ == '__main__':
    try:
        print(json.dumps(extract(sys.argv[1])))
    except Exception:
        sys.exit('October workbook validation failed; inspect the source privately.')

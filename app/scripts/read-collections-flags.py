#!/usr/bin/env python3
"""Preserve direct workbook cell-fill evidence; the owner defines red as overdue."""
import importlib.util
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def extract_flags(path):
    with zipfile.ZipFile(path) as archive:
        styles = ET.fromstring(archive.read('xl/styles.xml'))
        fills, xfs = styles.find('s:fills', NS), styles.find('s:cellXfs', NS)
        sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
        if sheet.findall('s:conditionalFormatting', NS):
            raise ValueError('Conditional formatting requires separate review')
        evidence = {}
        for cell in sheet.findall('.//s:sheetData/s:row/s:c', NS):
            ref, style_id = cell.get('r'), int(cell.get('s', '0'))
            fill_id = int(xfs[style_id].get('fillId', '0'))
            pattern = fills[fill_id].find('s:patternFill', NS)
            color = pattern.find('s:fgColor', NS) if pattern is not None else None
            if pattern is not None and pattern.get('patternType') == 'solid' and color is not None and color.get('rgb', '').upper() in ['FFFF0000', '00FF0000']:
                row = int(''.join(c for c in ref if c.isdigit()))
                evidence.setdefault(row, []).append({'cell': ref, 'styleIndex': style_id, 'fillIndex': fill_id, 'pattern': 'solid', 'rgb': color.get('rgb')})
    return evidence

if __name__ == '__main__':
    spec = importlib.util.spec_from_file_location('source', Path(__file__).with_name('read-october-workbook.py'))
    source = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source)
    try:
        payload = source.extract(sys.argv[1])
        flags = extract_flags(sys.argv[1])
        print(json.dumps({'records': [{'row': r['row'], 'name': r['name'], 'amount': r['amount'], 'sourceOverdue': r['row'] in flags, 'styleEvidence': flags.get(r['row'], [])} for r in payload['records']]}))
    except Exception:
        sys.exit('Workbook formatting validation failed; inspect the source privately.')

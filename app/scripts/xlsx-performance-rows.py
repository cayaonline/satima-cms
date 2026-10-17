"""Read only referenced rows from a private performance workbook; never log cell data."""
import json
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'


def text_of(node):
    return ''.join(item.text or '' for item in node.iter(f'{{{MAIN}}}t'))


def rows(path, row_numbers):
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        first = workbook.find(f'{{{MAIN}}}sheets/{{{MAIN}}}sheet')
        if first is None:
            raise ValueError('Workbook has no sheet')
        rel_id = first.attrib[f'{{{REL}}}id']
        rels = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        target = next((r.attrib['Target'] for r in rels.findall(f'{{{PKG}}}Relationship') if r.attrib['Id'] == rel_id), None)
        if not target:
            raise ValueError('Workbook sheet relationship is missing')
        sheet_path = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
            shared = [text_of(item) for item in root.findall(f'{{{MAIN}}}si')]
        sheet = ET.fromstring(archive.read(sheet_path))
        result = {}
        for row in sheet.findall(f'.//{{{MAIN}}}sheetData/{{{MAIN}}}row'):
            number = int(row.attrib['r'])
            if number not in row_numbers:
                continue
            cells = {}
            for cell in row.findall(f'{{{MAIN}}}c'):
                reference = cell.attrib.get('r', '')
                match = re.match(r'[A-Z]+', reference)
                if not match:
                    continue
                col = match.group()
                raw = cell.find(f'{{{MAIN}}}v')
                formula = cell.find(f'{{{MAIN}}}f')
                kind = cell.attrib.get('t')
                if kind == 's':
                    value = shared[int(raw.text)] if raw is not None and raw.text else None
                elif kind == 'inlineStr':
                    value = text_of(cell)
                else:
                    value = raw.text if raw is not None and raw.text else None
                if value is not None or formula is not None:
                    cells[col] = {'value': value, 'formula': formula.text if formula is not None else None}
            result[number] = cells
        return {'worksheet': first.attrib['name'], 'rows': result}


if __name__ == '__main__':
    try:
        selected = {int(x) for x in sys.argv[2].split(',')}
        if not selected or len(selected) > 500 or min(selected) < 1:
            raise ValueError('Invalid source row selection')
        json.dump(rows(sys.argv[1], selected), sys.stdout)
    except (IndexError, ValueError, KeyError, zipfile.BadZipFile) as exc:
        print('Workbook validation failed: ' + str(exc), file=sys.stderr)
        sys.exit(1)

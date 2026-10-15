"""Read a simple first-sheet .xlsx table using the Python standard library only.
Prints private rows as JSON for sync-master.mjs; never run directly in public logs.
"""
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
    return ''.join(part.text or '' for part in node.iter(f'{{{MAIN}}}t'))


def column_index(cell_reference):
    letters = re.match(r'[A-Z]+', cell_reference or '')
    if not letters:
        raise ValueError('Invalid Excel cell reference.')
    number = 0
    for letter in letters.group():
        number = number * 26 + ord(letter) - 64
    return number - 1


def main(path):
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        sheet = workbook.find(f'{{{MAIN}}}sheets/{{{MAIN}}}sheet')
        if sheet is None:
            raise ValueError('Workbook has no worksheet.')
        relation_id = sheet.attrib[f'{{{REL}}}id']
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        target = next((item.attrib['Target'] for item in relationships.findall(f'{{{PKG}}}Relationship') if item.attrib['Id'] == relation_id), None)
        if not target:
            raise ValueError('First worksheet is missing.')
        sheet_path = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = ET.fromstring(archive.read('xl/sharedStrings.xml'))
            shared = [text_of(item) for item in strings.findall(f'{{{MAIN}}}si')]
        worksheet = ET.fromstring(archive.read(sheet_path))
        output = []
        headers = None
        for row in worksheet.findall(f'.//{{{MAIN}}}sheetData/{{{MAIN}}}row'):
            cells = {}
            for cell in row.findall(f'{{{MAIN}}}c'):
                index = column_index(cell.attrib.get('r'))
                kind = cell.attrib.get('t')
                raw = cell.find(f'{{{MAIN}}}v')
                if kind == 's':
                    value = shared[int(raw.text)] if raw is not None and raw.text else ''
                elif kind == 'inlineStr':
                    value = text_of(cell)
                elif kind == 'b':
                    value = 'true' if raw is not None and raw.text == '1' else 'false'
                else:
                    value = raw.text if raw is not None and raw.text is not None else ''
                cells[index] = value.strip()
            if not cells or not any(cells.values()):
                continue
            if headers is None:
                headers = [cells.get(index, '') for index in range(max(cells) + 1)]
                named = [header for header in headers if header]
                if not named or len(set(named)) != len(named):
                    raise ValueError('First nonempty row must contain unique column headers.')
                continue
            output.append(dict([(header, cells.get(index, '')) for index, header in enumerate(headers) if header] + [('source_row', int(row.attrib['r']))]))
        if headers is None:
            raise ValueError('Worksheet has no header row.')
        json.dump(output, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    try:
        main(sys.argv[1])
    except (IndexError, KeyError, ValueError, zipfile.BadZipFile) as error:
        print(f'Workbook could not be read: {error}', file=sys.stderr)
        sys.exit(1)

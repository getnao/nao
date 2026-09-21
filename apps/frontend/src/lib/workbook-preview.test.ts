import { describe, expect, it } from 'vitest';
import writeXlsxFile from 'write-excel-file/universal';

import { capWorkbookForPreview, capWorksheetXml } from './workbook-preview';

describe('capWorksheetXml', () => {
	it('keeps a sheet that is already within the row budget', () => {
		const xml = worksheetXml(rowsXml(2));
		expect(capWorksheetXml(xml, 2)).toEqual({ xml, truncated: false });
		expect(capWorksheetXml(xml, 5)).toEqual({ xml, truncated: false });
	});

	it('drops rows beyond the budget and closes the sheet', () => {
		const { xml, truncated } = capWorksheetXml(worksheetXml(rowsXml(4)), 2);

		expect(truncated).toBe(true);
		expect(xml).toBe(worksheetXml(rowsXml(2)));
		expect(xml.match(/<row /g)).toHaveLength(2);
		expect(xml).toContain('</sheetData>');
		expect(xml).toContain('</worksheet>');
	});

	it('counts self-closing rows', () => {
		const xml = worksheetXml('<row r="1"/><row r="2"/><row r="3"/>');
		const capped = capWorksheetXml(xml, 2);

		expect(capped.truncated).toBe(true);
		expect(capped.xml).toBe(worksheetXml('<row r="1"/><row r="2"/>'));
	});

	it('does not treat rowBreaks as sheet rows', () => {
		const xml = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml(1)}</sheetData><rowBreaks count="1"><brk id="1"/></rowBreaks></worksheet>`;

		expect(capWorksheetXml(xml, 1)).toEqual({ xml, truncated: false });
	});

	it('leaves a sheet with no rows unchanged', () => {
		const xml = worksheetXml('');
		expect(capWorksheetXml(xml, 3)).toEqual({ xml, truncated: false });
		expect(capWorksheetXml(worksheetXmlEmptySelfClosing(), 3)).toEqual({
			xml: worksheetXmlEmptySelfClosing(),
			truncated: false,
		});
	});
});

describe('capWorkbookForPreview', () => {
	it('stops workbook parsing at the row budget', async () => {
		const blob = await writeXlsxFile(
			Array.from({ length: 8 }, (_, index) => [{ type: String, value: `r${index}` }]),
		).toBlob();

		const { default: readXlsxFile } = await import('read-excel-file/browser');
		const sheets = await readXlsxFile(await capWorkbookForPreview(blob, 3));

		expect(sheets).toHaveLength(1);
		expect(sheets[0]?.data).toEqual([['r0'], ['r1'], ['r2']]);
	});

	it('does not rewrite a workbook that already fits', async () => {
		const blob = await writeXlsxFile([[{ type: String, value: 'only' }]]).toBlob();

		await expect(capWorkbookForPreview(blob, 3)).resolves.toBe(blob);
	});
});

const rowsXml = (count: number): string => {
	return Array.from({ length: count }, (_, index) => {
		const row = index + 1;
		return `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>r${index}</t></is></c></row>`;
	}).join('');
};

const worksheetXml = (rows: string): string => {
	return `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
};

const worksheetXmlEmptySelfClosing = (): string => {
	return `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`;
};

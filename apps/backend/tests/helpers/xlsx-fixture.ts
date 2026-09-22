import { strToU8, zipSync } from 'fflate';

export interface SheetFixture {
	name: string;
	/** Used range the sheet records, e.g. `A1:C12`. Omitted for a sheet that records none. */
	range?: string;
	hidden?: boolean;
}

/**
 * Builds a real .xlsx — a zip of the parts an outline is read from — so the tests exercise the
 * archive and XML handling rather than a stub. No cells are written: nothing reads them.
 */
export const buildWorkbook = (sheets: SheetFixture[]): Buffer => {
	const parts: Record<string, Uint8Array> = {
		'[Content_Types].xml': strToU8(contentTypes(sheets.length)),
		'xl/workbook.xml': strToU8(workbook(sheets)),
		'xl/_rels/workbook.xml.rels': strToU8(workbookRels(sheets.length)),
	};

	sheets.forEach((sheet, index) => {
		parts[sheetPath(index)] = strToU8(worksheet(sheet.range));
	});

	return Buffer.from(zipSync(parts));
};

const sheetPath = (index: number): string => `xl/worksheets/sheet${index + 1}.xml`;

const workbook = (sheets: SheetFixture[]): string => {
	const entries = sheets.map((sheet, index) => {
		const state = sheet.hidden ? ' state="hidden"' : '';
		return `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"${state} r:id="rId${index + 1}"/>`;
	});

	return `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${entries.join('')}</sheets></workbook>`;
};

const workbookRels = (sheetCount: number): string => {
	const entries = Array.from({ length: sheetCount }, (_, index) => {
		return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`;
	});

	return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.join('')}</Relationships>`;
};

const worksheet = (range: string | undefined): string => {
	const dimension = range ? `<dimension ref="${range}"/>` : '';
	return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${dimension}<sheetData/></worksheet>`;
};

const contentTypes = (sheetCount: number): string => {
	const overrides = Array.from({ length: sheetCount }, (_, index) => {
		return `<Override PartName="/${sheetPath(index)}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
	});

	return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${overrides.join('')}</Types>`;
};

const escapeXml = (value: string): string => {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

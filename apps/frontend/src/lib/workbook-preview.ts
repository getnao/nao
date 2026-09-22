import JSZip from 'jszip';

const WORKSHEET_PATH = /(?:^|\/)worksheets\/[^/]+\.xml$/i;
const SHEET_DATA_OPEN = /<(?:[A-Za-z_][\w.-]*:)?sheetData(?=[\s/>])/g;
const SHEET_DATA_CLOSE = /<\/(?:[A-Za-z_][\w.-]*:)?sheetData>/g;
const ROW_OPEN = /<(?:[A-Za-z_][\w.-]*:)?row(?=[\s/>])/g;
const ROW_CLOSE = /<\/(?:[A-Za-z_][\w.-]*:)?row>/g;

/**
 * Drops worksheet rows the preview will not show, so the parser never builds them.
 * An `.xlsx` is compressed XML: a 10 MB file can hold far more rows than the browser should materialize.
 */
export async function capWorkbookForPreview(blob: Blob, maxRows: number): Promise<Blob> {
	const zip = await JSZip.loadAsync(await blob.arrayBuffer());
	const worksheets = Object.values(zip.files).filter((file) => !file.dir && WORKSHEET_PATH.test(file.name));
	let changed = false;

	for (const file of worksheets) {
		const capped = capWorksheetXml(await file.async('string'), maxRows);
		if (capped.truncated) {
			zip.file(file.name, capped.xml);
			changed = true;
		}
	}

	if (!changed) {
		return blob;
	}

	return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export function capWorksheetXml(xml: string, maxRows: number): { xml: string; truncated: boolean } {
	SHEET_DATA_OPEN.lastIndex = 0;
	const sheetOpen = SHEET_DATA_OPEN.exec(xml);
	if (!sheetOpen) {
		return { xml, truncated: false };
	}

	const openEnd = xml.indexOf('>', sheetOpen.index);
	if (openEnd === -1 || xml[openEnd - 1] === '/') {
		return { xml, truncated: false };
	}

	SHEET_DATA_CLOSE.lastIndex = openEnd;
	const sheetClose = SHEET_DATA_CLOSE.exec(xml);
	if (!sheetClose) {
		return { xml, truncated: false };
	}

	if (maxRows <= 0) {
		if (!hasRow(xml, openEnd + 1, sheetClose.index)) {
			return { xml, truncated: false };
		}
		return { xml: xml.slice(0, openEnd + 1) + xml.slice(sheetClose.index), truncated: true };
	}

	ROW_OPEN.lastIndex = openEnd;
	let rows = 0;
	let lastRowEnd = openEnd + 1;

	while (rows < maxRows) {
		const row = ROW_OPEN.exec(xml);
		if (!row || row.index >= sheetClose.index) {
			return { xml, truncated: false };
		}

		const rowEnd = endOfRow(xml, row.index);
		if (rowEnd === -1 || rowEnd > sheetClose.index) {
			return { xml, truncated: false };
		}

		lastRowEnd = rowEnd;
		ROW_OPEN.lastIndex = rowEnd;
		rows += 1;
	}

	const extra = ROW_OPEN.exec(xml);
	if (!extra || extra.index >= sheetClose.index) {
		return { xml, truncated: false };
	}

	return { xml: xml.slice(0, lastRowEnd) + xml.slice(sheetClose.index), truncated: true };
}

function hasRow(xml: string, from: number, until: number): boolean {
	ROW_OPEN.lastIndex = from;
	const row = ROW_OPEN.exec(xml);
	return row !== null && row.index < until;
}

function endOfRow(xml: string, start: number): number {
	const tagEnd = xml.indexOf('>', start);
	if (tagEnd === -1) {
		return -1;
	}
	if (xml[tagEnd - 1] === '/') {
		return tagEnd + 1;
	}

	ROW_CLOSE.lastIndex = tagEnd + 1;
	const close = ROW_CLOSE.exec(xml);
	return close ? close.index + close[0].length : -1;
}

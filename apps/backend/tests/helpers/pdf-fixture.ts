/**
 * Builds a real PDF by hand so the extraction tests exercise pdf.js rather than a stub.
 * Each page carries one line of text; a page given an empty string gets no text object at
 * all, which is how a scanned page looks to an extractor.
 */
export const buildPdf = (pageTexts: string[]): Buffer => {
	const pageCount = pageTexts.length;
	const catalog = '<</Type/Catalog/Pages 2 0 R>>';
	const font = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';

	// Object numbering: 1 catalog, 2 page tree, 3 font, then a page and a content stream per page.
	const firstPageObject = 4;
	const kids = pageTexts.map((_, index) => `${firstPageObject + index * 2} 0 R`).join(' ');

	const objects: string[] = [catalog, `<</Type/Pages/Kids[${kids}]/Count ${pageCount}>>`, font];

	pageTexts.forEach((text, index) => {
		const contentsObject = firstPageObject + index * 2 + 1;
		const stream = text === '' ? '' : `BT /F1 14 Tf 20 120 Td (${escapePdfText(text)}) Tj ET`;
		objects.push(
			`<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Resources<</Font<</F1 3 0 R>>>>/Contents ${contentsObject} 0 R>>`,
			`<</Length ${stream.length}>>stream\n${stream}\nendstream`,
		);
	});

	let body = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((object, index) => {
		offsets.push(body.length);
		body += `${index + 1} 0 obj${object}endobj\n`;
	});

	const xrefStart = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) {
		body += `${String(offset).padStart(10, '0')} 00000 n \n`;
	}
	body += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;

	return Buffer.from(body, 'latin1');
};

const escapePdfText = (text: string): string => {
	return text.replace(/([\\()])/g, '\\$1');
};

import { extractText, getDocumentProxy } from 'unpdf';

const MAX_PDF_PAGES = 1000;

/**
 * Pulls the text layer out of a PDF so the agent can read one like any other file.
 *
 * Pages are kept apart and labelled: a PDF is the one format users routinely talk about by
 * page ("the table on page 4"), and the markers survive the truncation the read tool applies
 * downstream, so a partial read still says where it stopped.
 */
export const extractPdfText = async (data: Buffer): Promise<string> => {
	const pages = await extractPages(data);
	const withText = pages.filter((page) => page.text !== '');

	if (withText.length === 0) {
		throw new Error(
			`This PDF has ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} but no text layer, which means it is scanned or made of images. Its text cannot be extracted. Tell the user it needs OCR, or ask them for the underlying data.`,
		);
	}

	const header = `PDF with ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}${describeEmptyPages(pages.length - withText.length)}.`;
	const body = withText.map((page) => `--- Page ${page.number} ---\n${page.text}`);

	return [header, ...body].join('\n\n');
};

interface PdfPage {
	number: number;
	text: string;
}

const extractPages = async (data: Buffer): Promise<PdfPage[]> => {
	let document: Awaited<ReturnType<typeof getDocumentProxy>>;
	try {
		document = await getDocumentProxy(new Uint8Array(data));
	} catch (error) {
		throw new Error(`This PDF could not be opened, so it may be corrupt or password-protected: ${reason(error)}`);
	}

	try {
		if (document.numPages > MAX_PDF_PAGES) {
			throw new Error(
				`This PDF has ${document.numPages} pages, above the ${MAX_PDF_PAGES}-page extraction limit. Ask for a smaller document or the relevant page range.`,
			);
		}

		const { text: pageTexts } = await extractText(document, { mergePages: false });
		return pageTexts.map((text, index) => ({ number: index + 1, text: normalizeWhitespace(text) }));
	} finally {
		await document.loadingTask.destroy();
	}
};

/**
 * pdf.js emits a space per positioned glyph run, which turns a table row into a line of
 * scattered words. Collapsing runs keeps it readable without pretending layout survived.
 */
const normalizeWhitespace = (text: string): string => {
	return text
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
};

const describeEmptyPages = (count: number): string => {
	if (count === 0) {
		return '';
	}
	return `, ${count} of which ${count === 1 ? 'holds' : 'hold'} no text and ${count === 1 ? 'is' : 'are'} left out below`;
};

const reason = (error: unknown): string => {
	return error instanceof Error ? error.message : String(error);
};

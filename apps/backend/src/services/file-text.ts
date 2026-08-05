import { fileExtension, isBinaryDocument } from '@nao/shared/attachments';

import { extractPdfText } from './pdf';
import { describeWorkbook } from './workbook';

/** Enough of the file to tell text from binary without holding a second copy of a large one. */
const BINARY_SNIFF_BYTES = 8192;

/**
 * Turns a file's bytes into something worth putting in a conversation, wherever it came from.
 *
 * PDFs go through text extraction, and an .xlsx comes back as an outline of its sheets rather
 * than their cells, which is what a reader needs before querying one. Every other binary format
 * is refused with an explanation: decoding a Parquet file as UTF-8 produces noise the model would
 * then reason about as if it meant something, which is worse than not reading the file at all.
 * @throws Error when the file has no text to offer.
 */
export const toReadableText = async (name: string, data: Buffer): Promise<string> => {
	const extension = fileExtension(name);

	if (extension === 'pdf') {
		return extractPdfText(data);
	}

	if (extension === 'xlsx') {
		return describeWorkbook(data);
	}

	assertReadableAsText(name, data);
	return data.toString('utf-8');
};

const assertReadableAsText = (name: string, data: Buffer): void => {
	const looksBinary = isBinaryDocument(name) || data.subarray(0, BINARY_SNIFF_BYTES).includes(0);
	if (!looksBinary) {
		return;
	}

	const extension = fileExtension(name);
	throw new Error(
		`${name} is not a text file${extension ? ` (.${extension})` : ''}, so its contents cannot be read into the conversation. Describe what you need from it and ask the user for a text export such as CSV, or parse it in a sandbox if one is available.`,
	);
};

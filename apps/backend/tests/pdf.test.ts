import { describe, expect, it } from 'vitest';

import { extractPdfText } from '../src/services/pdf';
import { buildPdf } from './helpers/pdf-fixture';

describe('extractPdfText', () => {
	it('returns the text of each page behind a page marker', async () => {
		const text = await extractPdfText(buildPdf(['Revenue 1234', 'Costs 567']));

		expect(text).toContain('--- Page 1 ---');
		expect(text).toContain('Revenue 1234');
		expect(text).toContain('--- Page 2 ---');
		expect(text).toContain('Costs 567');
	});

	it('leads with the page count, so a truncated read still reveals what is missing', async () => {
		const text = await extractPdfText(buildPdf(['a', 'b', 'c']));

		expect(text.split('\n')[0]).toBe('PDF with 3 pages.');
	});

	it('says which pages held no text rather than dropping them silently', async () => {
		const text = await extractPdfText(buildPdf(['only this page', '']));

		expect(text.split('\n')[0]).toContain('1 of which holds no text');
		expect(text).not.toContain('--- Page 2 ---');
	});

	it('explains that a PDF without any text layer needs OCR', async () => {
		await expect(extractPdfText(buildPdf(['', '']))).rejects.toThrow(/no text layer/);
		await expect(extractPdfText(buildPdf(['', '']))).rejects.toThrow(/OCR/);
	});

	it('reports an unreadable file as corrupt or protected instead of throwing a parser error', async () => {
		await expect(extractPdfText(Buffer.from('this is not a pdf'))).rejects.toThrow(/corrupt or password-protected/);
	});

	it('collapses the runs of spaces pdf.js emits between positioned glyphs', async () => {
		const text = await extractPdfText(buildPdf(['Total     due     42']));

		expect(text).toContain('Total due 42');
	});
});

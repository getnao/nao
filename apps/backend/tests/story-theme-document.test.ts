import { cleanDocumentText } from '@nao/shared/story-theme-source';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { documentColors, fitDocumentsToPrompt, renderDocuments } from '../src/services/story-theme/document';
import { extractSignalsFromZip } from '../src/services/story-theme/zip';

describe('story theme documents', () => {
	it('reads the six-digit hex codes a document prints, once each', () => {
		const colors = documentColors([
			{
				fileName: 'brand.md',
				text: '# Palette\n\n- Primary: #0A2540\n- Accent: #FFB800\n- Again: #0a2540\n- Issue #123',
			},
		]);

		expect(colors).toEqual(['#0a2540', '#ffb800']);
	});

	it('shares one character budget across documents and reports what was cut', () => {
		const long = 'a'.repeat(30_000);
		const { documents, warnings } = fitDocumentsToPrompt([
			{ fileName: 'guidelines.md', text: long },
			{ fileName: 'notes.txt', text: 'Use square cards.' },
			{ fileName: 'blank.txt', text: '   ' },
		]);

		expect(documents).toHaveLength(1);
		expect(documents[0].text).toHaveLength(24_000);
		expect(warnings).toEqual([
			'Read the first 24,000 of the 30,000 characters of guidelines.md.',
			'notes.txt was left out: the documents before it fill what nao reads at once.',
		]);
	});

	it('keeps the guidelines behind an embedded image inside the budget', () => {
		const embedded = `![logo](data:image/png;base64,${'A'.repeat(40_000)})`;
		const { documents, warnings } = fitDocumentsToPrompt([
			{ fileName: 'brand.md', text: `# Lumen\n\n${embedded}\n\n## Palette\n\nAccent: #E4572E` },
		]);

		expect(documents[0].text).toBe('# Lumen\n\n## Palette\n\nAccent: #E4572E');
		expect(warnings).toEqual([]);
	});

	it('cleans comments, inline data URIs and layout padding from a document', () => {
		const text = [
			'<!-- exported by Notion -->',
			'| Role     | Hex       |   ',
			'| Accent   | `#E4572E` |',
			'',
			'',
			'',
			'<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="mark"> Logo: [mark]: data:image/png;base64,iVBORw0=',
			'  - Nested ![dot](data:image/png;base64,iVBORw0=) bullet',
		].join('\r\n');

		expect(cleanDocumentText(text)).toBe(
			'| Role | Hex |\n| Accent | `#E4572E` |\n\nLogo: [mark]:\n - Nested bullet',
		);
	});

	it('cleans a line padded with a long run of spaces in linear time', () => {
		const padded = `A${' '.repeat(500_000)}B`;
		const startedAt = performance.now();

		expect(cleanDocumentText(padded)).toBe('A B');
		expect(performance.now() - startedAt).toBeLessThan(500);
	});

	it('renders each document under its file name', () => {
		const prompt = renderDocuments([{ fileName: 'brand.md', text: 'Headings use Inter.' }]);

		expect(prompt).toContain('BRAND DOCUMENTS');
		expect(prompt).toContain('--- brand.md ---\nHeadings use Inter.');
		expect(prompt).toContain('take them over the white-label branding');
		expect(prompt).toContain('The brand name they state is the brandName');
	});

	it('keeps written guidelines from a ZIP and skips licence files', () => {
		const zip = zipSync({
			'kit/guidelines.md': strToU8('Primary #0a2540, cards are square.'),
			'kit/fonts/OFL.txt': strToU8('SIL Open Font License'),
			'kit/tokens.css': strToU8(':root { --brand: #0a2540; }'),
		});

		const { documents } = extractSignalsFromZip(zip, 'kit.zip');

		expect(documents).toEqual([{ fileName: 'guidelines.md', text: 'Primary #0a2540, cards are square.' }]);
	});

	it('accepts a ZIP that only holds written guidelines', () => {
		const zip = zipSync({ 'brand.txt': strToU8('Navy and amber, no purple.') });

		const { documents, signals } = extractSignalsFromZip(zip, 'brand.zip');

		expect(documents).toHaveLength(1);
		expect(signals.warnings).toContain(
			'No stylesheets or token files were found; the theme is read from the written guidelines alone.',
		);
	});
});

import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { describeWorkbook } from '../src/services/workbook';
import { buildWorkbook } from './helpers/xlsx-fixture';

describe('describeWorkbook', () => {
	it('lists every sheet in tab order, so nothing after the first one is invisible', () => {
		const outline = describeWorkbook(
			buildWorkbook([
				{ name: 'Cover', range: 'A1:B8' },
				{ name: 'FY26', range: 'A1:N412' },
				{ name: 'Archive', range: 'A1:N900' },
			]),
		);

		expect(outline).toContain('Excel workbook with 3 sheets');
		expect(outline.split('\n').slice(1, 4)).toEqual([
			"- 'Cover' — 8 rows × 2 columns (A1:B8)",
			"- 'FY26' — 412 rows × 14 columns (A1:N412)",
			"- 'Archive' — 900 rows × 14 columns (A1:N900)",
		]);
	});

	it('shows how to query a sheet, naming one that really exists', () => {
		const outline = describeWorkbook(buildWorkbook([{ name: 'Budget FY26', range: 'A1:C3' }]));

		expect(outline).toContain('Excel workbook with 1 sheet');
		expect(outline).toContain("read_xlsx('<path>', sheet = 'Budget FY26')");
	});

	it('escapes an apostrophe in the suggested SQL sheet name', () => {
		const outline = describeWorkbook(buildWorkbook([{ name: "Director's view", range: 'A1:C3' }]));

		expect(outline).toContain("sheet = 'Director''s view'");
	});

	it('flags a hidden sheet rather than passing it off as the working copy', () => {
		const outline = describeWorkbook(
			buildWorkbook([
				{ name: 'Summary', range: 'A1:C3' },
				{ name: 'Old', range: 'A1:C3', hidden: true },
			]),
		);

		expect(outline).toContain("- 'Summary' —");
		expect(outline).toContain("- 'Old' (hidden) —");
	});

	it('gives back the sheet name as Excel shows it, not as the XML escapes it', () => {
		const outline = describeWorkbook(buildWorkbook([{ name: 'Q1 & Q2 <draft>', range: 'A1:A1' }]));

		expect(outline).toContain("'Q1 & Q2 <draft>'");
	});

	it('counts columns past the first alphabet', () => {
		const outline = describeWorkbook(buildWorkbook([{ name: 'Wide', range: 'A1:AB2' }]));

		expect(outline).toContain('2 rows × 28 columns');
	});

	it('reads a single-cell range as one cell instead of failing', () => {
		const outline = describeWorkbook(buildWorkbook([{ name: 'Empty', range: 'A1' }]));

		expect(outline).toContain("'Empty' — 1 row × 1 column (A1)");
	});

	it('says so when a sheet records no used range, rather than inventing a size', () => {
		const outline = describeWorkbook(buildWorkbook([{ name: 'Notes' }]));

		expect(outline).toContain("'Notes' — size not recorded in the file");
	});

	it('warns that the counts cover the used range, not the table inside it', () => {
		const outline = describeWorkbook(buildWorkbook([{ name: 'FY26', range: 'A1:C9' }]));

		expect(outline).toMatch(/used range the file records/);
	});

	it('reports a file that is not an archive as unreadable instead of guessing', () => {
		expect(() => describeWorkbook(Buffer.from('PK\u0003\u0004 not really a zip'))).toThrow(
			/corrupt or password-protected/,
		);
	});

	it('reports an archive that holds no workbook part', () => {
		const notAWorkbook = Buffer.from(zipSync({ 'hello.txt': new Uint8Array([1, 2, 3]) }));

		expect(() => describeWorkbook(notAWorkbook)).toThrow(/no xl\/workbook\.xml part/);
	});

	it('reports a workbook with no sheet at all', () => {
		expect(() => describeWorkbook(buildWorkbook([]))).toThrow(/declares no sheet/);
	});
});

// @vitest-environment jsdom

import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadXlsx, tableToCsv, tableToTsv } from '@/lib/table-export';

const columns = ['day', 'label'];
const rows = [{ day: '2024-03-15', label: 'launch' }];

describe('tableToCsv', () => {
	it('formats ISO dates with the provided date format settings', () => {
		expect(tableToCsv(columns, rows, { preset: 'american' })).toBe('day,label\n03/15/2024,launch');
		expect(tableToCsv(columns, rows, { preset: 'iso' })).toBe('day,label\n2024-03-15,launch');
		expect(tableToCsv(columns, rows, { preset: 'custom', customFormat: 'D MMM YYYY' })).toBe(
			'day,label\n15 Mar 2024,launch',
		);
	});

	it('falls back to the European default when no settings are known', () => {
		expect(tableToCsv(columns, rows, null)).toBe('day,label\n15/03/2024,launch');
	});

	it('quotes formatted dates that contain a comma', () => {
		expect(tableToCsv(columns, rows, { preset: 'custom', customFormat: 'MMMM D, YYYY' })).toBe(
			'day,label\n"March 15, 2024",launch',
		);
	});

	it('keeps negative numbers as numbers while still neutralizing formulas', () => {
		const signedRows = [
			{ delta: -5, ratio: -0.25, amount: '-12.50', code: '-007', note: '-2+3' },
			{ delta: 3, ratio: 0.5, amount: '7', code: '007', note: '=SUM(A1:A2)' },
			{ delta: -1, ratio: -1, amount: '-5e-3', code: '-007', note: '+5' },
		];
		expect(tableToCsv(['delta', 'ratio', 'amount', 'code', 'note'], signedRows, null)).toBe(
			"delta,ratio,amount,code,note\n-5,-0.25,'-12.50,'-007,'-2+3\n3,0.5,7,007,'=SUM(A1:A2)\n-1,-1,'-5e-3,'-007,'+5",
		);
	});
});

describe('tableToTsv', () => {
	it('formats ISO dates with the provided date format settings', () => {
		expect(tableToTsv(columns, rows, { preset: 'american' })).toBe('day\tlabel\n03/15/2024\tlaunch');
	});

	it('keeps negative numbers as numbers while still neutralizing formulas', () => {
		const signedRows = [{ delta: -5, code: '-007', note: '@cmd' }];
		expect(tableToTsv(['delta', 'code', 'note'], signedRows, null)).toBe("delta\tcode\tnote\n-5\t'-007\t'@cmd");
	});
});

describe('downloadXlsx', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('writes ISO dates using the provided date format settings', async () => {
		const blob = await captureDownloadedBlob(() =>
			downloadXlsx('table.xlsx', columns, rows, { preset: 'american' }),
		);

		const content = await readXlsxText(blob);
		expect(content).toContain('03/15/2024');
		expect(content).not.toContain('15/03/2024');
	});
});

async function captureDownloadedBlob(download: () => Promise<void>): Promise<Blob> {
	let captured: Blob | undefined;
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
	vi.stubGlobal('URL', {
		...URL,
		createObjectURL: (blob: Blob) => {
			captured = blob;
			return 'blob:mock';
		},
		revokeObjectURL: () => undefined,
	});

	await download();

	if (!captured) {
		throw new Error('No blob was downloaded');
	}
	return captured;
}

async function readXlsxText(blob: Blob): Promise<string> {
	const zip = await JSZip.loadAsync(blob);
	const sheets = zip.file(/xl\/(worksheets\/.*|sharedStrings)\.xml/);
	const contents = await Promise.all(sheets.map((file) => file.async('string')));
	return contents.join('\n');
}

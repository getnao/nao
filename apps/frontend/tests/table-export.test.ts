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
});

describe('tableToTsv', () => {
	it('formats ISO dates with the provided date format settings', () => {
		expect(tableToTsv(columns, rows, { preset: 'american' })).toBe('day\tlabel\n03/15/2024\tlaunch');
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

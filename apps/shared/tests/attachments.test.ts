import { describe, expect, it } from 'vitest';

import {
	ATTACHMENT_ACCEPT,
	documentMediaType,
	fileExtension,
	isBinaryDocument,
	isImageMediaType,
	toSafeFileName,
} from '../src/attachments';

describe('documentMediaType', () => {
	it('trusts the extension rather than whatever a browser reported', () => {
		expect(documentMediaType('sales.csv')).toBe('text/csv');
		expect(documentMediaType('SALES.CSV')).toBe('text/csv');
		expect(documentMediaType('book.xlsx')).toBe(
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		);
	});

	it('rejects an extension nao has no use for', () => {
		expect(documentMediaType('installer.exe')).toBeUndefined();
		expect(documentMediaType('archive.zip')).toBeUndefined();
		expect(documentMediaType('README')).toBeUndefined();
		expect(documentMediaType('file.__proto__')).toBeUndefined();
		expect(documentMediaType('file.constructor')).toBeUndefined();
	});

	it('reads the extension from the last dot only', () => {
		expect(documentMediaType('q3.report.final.csv')).toBe('text/csv');
		expect(fileExtension('.hidden')).toBe('');
	});
});

describe('isBinaryDocument', () => {
	it('separates files whose bytes can be read as text from those that cannot', () => {
		expect(isBinaryDocument('report.pdf')).toBe(true);
		expect(isBinaryDocument('book.xlsx')).toBe(true);
		expect(isBinaryDocument('events.parquet')).toBe(true);
		expect(isBinaryDocument('sales.csv')).toBe(false);
		expect(isBinaryDocument('notes.md')).toBe(false);
	});
});

describe('isImageMediaType', () => {
	it('accepts only the image types the model is given inline', () => {
		expect(isImageMediaType('image/png')).toBe(true);
		expect(isImageMediaType('image/svg+xml')).toBe(false);
		expect(isImageMediaType('text/csv')).toBe(false);
	});
});

describe('toSafeFileName', () => {
	it('keeps a name that is already usable', () => {
		expect(toSafeFileName('Q3 revenue (final).csv')).toBe('Q3 revenue (final).csv');
		expect(toSafeFileName('ventes-été.csv')).toBe('ventes-été.csv');
	});

	it('drops everything that could point outside the uploads folder', () => {
		expect(toSafeFileName('../../etc/passwd.csv')).toBe('passwd.csv');
		expect(toSafeFileName('C:\\Users\\me\\sales.csv')).toBe('sales.csv');
		expect(toSafeFileName('.hidden.csv')).toBe('hidden.csv');
	});

	it('gives up on a name with nothing left in it', () => {
		expect(toSafeFileName('')).toBeUndefined();
		expect(toSafeFileName('   ')).toBeUndefined();
		expect(toSafeFileName('../..')).toBeUndefined();
	});

	it('shortens a very long name without losing its extension', () => {
		const safeName = toSafeFileName(`${'a'.repeat(300)}.csv`)!;
		expect(safeName.length).toBeLessThanOrEqual(120);
		expect(safeName.endsWith('.csv')).toBe(true);
	});
});

describe('ATTACHMENT_ACCEPT', () => {
	it('offers image types and document extensions to the file picker', () => {
		expect(ATTACHMENT_ACCEPT).toContain('image/png');
		expect(ATTACHMENT_ACCEPT).toContain('.csv');
		expect(ATTACHMENT_ACCEPT).toContain('.xlsx');
		expect(ATTACHMENT_ACCEPT).not.toContain('.exe');
	});
});

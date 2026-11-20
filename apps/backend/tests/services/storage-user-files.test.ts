import fs from 'node:fs/promises';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { __reloadEnvForTesting } from '../../src/env';
import { STORAGE_DISABLED_MESSAGE } from '../../src/services/storage';
import {
	findUserFiles,
	grepRootForUser,
	listUserDirectory,
	readUserFile,
	saveUploadedFile,
	statUserFile,
	writeUserFile,
} from '../../src/services/storage/user-files';
import { buildPdf } from '../helpers/pdf-fixture';
import { otherUserScope, userScope, useStorageBackend, useTemporaryLocalStorage } from '../helpers/storage-backend';
import { buildWorkbook } from '../helpers/xlsx-fixture';

const storageRoot = useTemporaryLocalStorage();

describe('writeUserFile', () => {
	it('writes inside the user space and reads back', async () => {
		const object = await writeUserFile(userScope, 'reports/q1.csv', 'week,customers\n');

		expect(object.key).toBe('projects/proj-1/users/user-1/reports/q1.csv');
		expect(await readUserFile(userScope, 'reports/q1.csv')).toBe('week,customers\n');
	});

	it('sets a content type from the extension', async () => {
		expect((await writeUserFile(userScope, 'a.csv', 'x')).contentType).toBe('text/csv');
		expect((await writeUserFile(userScope, 'a.unknown', 'x')).contentType).toBe('text/plain');
	});

	it('rejects a path that tries to escape the user space', async () => {
		await expect(writeUserFile(userScope, '../user-2/stolen.csv', 'x')).rejects.toThrow("may not contain '..'");
	});

	it('fails with an explicit message when storage is disabled', async () => {
		useStorageBackend('none');
		await expect(writeUserFile(userScope, 'a.csv', 'x')).rejects.toThrow(STORAGE_DISABLED_MESSAGE);
	});

	it('rejects a file above the size limit and stores nothing', async () => {
		useSizeLimit(1);

		await expect(writeUserFile(userScope, 'big.csv', 'x'.repeat(1024 * 1024 + 1))).rejects.toThrow(
			'File too large: big.csv is 1.0 MB, above the 1 MB limit',
		);
		await expect(readUserFile(userScope, 'big.csv')).rejects.toThrow('No such file in permanent storage');
	});

	it('accepts a file exactly at the size limit', async () => {
		useSizeLimit(1);

		const object = await writeUserFile(userScope, 'big.csv', 'x'.repeat(1024 * 1024));
		expect(object.size).toBe(1024 * 1024);
	});

	it('measures the limit in bytes, not characters', async () => {
		useSizeLimit(1);

		await expect(writeUserFile(userScope, 'accents.csv', 'é'.repeat(1024 * 512 + 1))).rejects.toThrow(
			'File too large',
		);
	});
});

describe('readUserFile', () => {
	it('reports a missing file with the path the caller asked for', async () => {
		await expect(readUserFile(userScope, 'reports/missing.csv')).rejects.toThrow(
			'No such file in permanent storage: reports/missing.csv',
		);
	});

	it('refuses a file whose extension is never text', async () => {
		await saveUploadedFile(userScope, 'events.parquet', Buffer.from('PAR1 mostly ascii'));

		await expect(readUserFile(userScope, await onlyUploadPath())).rejects.toThrow(
			'is not a text file (.parquet), so its contents cannot be read into the conversation',
		);
	});

	it('refuses a text-looking file that turns out to hold binary', async () => {
		await saveUploadedFile(userScope, 'export.csv', Buffer.from([0x61, 0x00, 0x62]));

		await expect(readUserFile(userScope, await onlyUploadPath())).rejects.toThrow('is not a text file');
	});

	it('extracts the text of a pdf instead of refusing it', async () => {
		await saveUploadedFile(userScope, 'report.pdf', buildPdf(['Q3 revenue 1.2M']));

		const content = await readUserFile(userScope, await onlyUploadPath());

		expect(content).toContain('PDF with 1 page.');
		expect(content).toContain('Q3 revenue 1.2M');
	});

	it('reports a pdf it cannot parse rather than returning its bytes', async () => {
		await saveUploadedFile(userScope, 'report.pdf', Buffer.from('%PDF-1.7 truncated'));

		await expect(readUserFile(userScope, await onlyUploadPath())).rejects.toThrow(/corrupt or password-protected/);
	});

	it('outlines the sheets of a workbook instead of refusing it', async () => {
		await saveUploadedFile(
			userScope,
			'budget.xlsx',
			buildWorkbook([
				{ name: 'Cover', range: 'A1:B4' },
				{ name: 'FY26', range: 'A1:N412' },
			]),
		);

		const content = await readUserFile(userScope, await onlyUploadPath());

		expect(content).toContain('Excel workbook with 2 sheets');
		expect(content).toContain("- 'FY26' — 412 rows × 14 columns (A1:N412)");
	});

	it('reports a workbook it cannot open rather than returning its bytes', async () => {
		await saveUploadedFile(userScope, 'book.xlsx', Buffer.from('PK\u0003\u0004 mostly ascii'));

		await expect(readUserFile(userScope, await onlyUploadPath())).rejects.toThrow(/corrupt or password-protected/);
	});
});

describe('saveUploadedFile', () => {
	it('files an upload under today in the uploads folder', async () => {
		const object = await saveUploadedFile(userScope, 'Q3 revenue.csv', Buffer.from('a,b\n'));
		const today = new Date().toISOString().slice(0, 10);

		expect(object.key).toBe(`projects/proj-1/users/user-1/uploads/${today}/Q3 revenue.csv`);
		expect(object.contentType).toBe('text/csv');
	});

	it('keeps the bytes intact for a binary file', async () => {
		const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
		const object = await saveUploadedFile(userScope, 'book.xlsx', bytes);

		expect(object.size).toBe(bytes.byteLength);
		expect(await fs.readFile(path.join(storageRoot(), object.key))).toEqual(bytes);
	});

	it('suffixes a name already taken instead of replacing the earlier upload', async () => {
		const first = await saveUploadedFile(userScope, 'sales.csv', Buffer.from('first'));
		const second = await saveUploadedFile(userScope, 'sales.csv', Buffer.from('second'));

		expect(second.key).not.toBe(first.key);
		expect(second.key.endsWith('/sales-2.csv')).toBe(true);
		expect(await fs.readFile(path.join(storageRoot(), first.key), 'utf-8')).toBe('first');
	});

	it('strips a directory out of the name a browser reported', async () => {
		const object = await saveUploadedFile(userScope, '../../../etc/passwd.csv', Buffer.from('x'));
		expect(object.key).toContain('/passwd.csv');
		expect(object.key.startsWith('projects/proj-1/users/user-1/uploads/')).toBe(true);
	});

	it('refuses a file type nao cannot do anything with', async () => {
		await expect(saveUploadedFile(userScope, 'malware.exe', Buffer.from('x'))).rejects.toThrow(
			'Files of type .exe cannot be uploaded',
		);
		await expect(saveUploadedFile(userScope, 'noextension', Buffer.from('x'))).rejects.toThrow(
			'Files without an extension cannot be uploaded',
		);
	});

	it('refuses a file above the size limit', async () => {
		useSizeLimit(1);
		await expect(saveUploadedFile(userScope, 'big.csv', Buffer.alloc(1024 * 1024 + 1))).rejects.toThrow(
			'File too large: big.csv',
		);
	});

	it('lands somewhere statUserFile can find again', async () => {
		const object = await saveUploadedFile(userScope, 'sales.csv', Buffer.from('a,b\n'));
		const relativePath = object.key.replace('projects/proj-1/users/user-1/', '');

		expect(await statUserFile(userScope, relativePath)).not.toBeNull();
		expect(await statUserFile(otherUserScope, relativePath)).toBeNull();
	});
});

describe('listUserDirectory', () => {
	beforeEach(async () => {
		await writeUserFile(userScope, 'notes.md', 'notes');
		await writeUserFile(userScope, 'reports/q1.csv', 'q1');
		await writeUserFile(userScope, 'reports/2025/q2.csv', 'q2');
		await writeUserFile(otherUserScope, 'theirs.md', 'theirs');
	});

	it('lists directories before files at the root', async () => {
		expect(await listUserDirectory(userScope, '')).toEqual([
			{ name: 'reports', relativePath: 'reports', type: 'directory', itemCount: 2 },
			{ name: 'notes.md', relativePath: 'notes.md', type: 'file', size: 5 },
		]);
	});

	it('lists one level of a subdirectory', async () => {
		expect(await listUserDirectory(userScope, 'reports')).toEqual([
			{ name: '2025', relativePath: 'reports/2025', type: 'directory', itemCount: 1 },
			{ name: 'q1.csv', relativePath: 'reports/q1.csv', type: 'file', size: 2 },
		]);
	});

	it('returns nothing for a space that has never been written to', async () => {
		expect(await listUserDirectory({ projectId: 'proj-9', userId: 'user-9' }, '')).toEqual([]);
	});
});

describe('findUserFiles', () => {
	beforeEach(async () => {
		await writeUserFile(userScope, 'notes.md', 'notes');
		await writeUserFile(userScope, 'reports/q1.csv', 'q1');
		await writeUserFile(userScope, 'reports/2025/q2.csv', 'q2');
		await writeUserFile(otherUserScope, 'theirs.csv', 'theirs');
	});

	it('returns every file the predicate accepts, sorted by key', async () => {
		const objects = await findUserFiles(userScope, (relativePath) => relativePath.endsWith('.csv'));

		expect(objects.map((object) => object.key)).toEqual([
			'projects/proj-1/users/user-1/reports/2025/q2.csv',
			'projects/proj-1/users/user-1/reports/q1.csv',
		]);
	});

	it('offers the predicate a path relative to the user space', async () => {
		const seen: string[] = [];
		await findUserFiles(userScope, (relativePath) => {
			seen.push(relativePath);
			return false;
		});

		expect(seen).toEqual(['notes.md', 'reports/2025/q2.csv', 'reports/q1.csv']);
	});
});

describe('grepRootForUser', () => {
	it('points at the user space on the local backend', () => {
		expect(grepRootForUser(userScope)).toBe(path.join(storageRoot(), 'projects/proj-1/users/user-1'));
		expect(grepRootForUser(userScope, 'reports')).toBe(
			path.join(storageRoot(), 'projects/proj-1/users/user-1/reports'),
		);
	});

	it('is unavailable on the s3 backend', () => {
		useStorageBackend('s3');
		expect(() => grepRootForUser(userScope)).toThrow('requires the `local` storage backend');
	});

	it('is unavailable when storage is disabled', () => {
		useStorageBackend('none');
		expect(() => grepRootForUser(userScope)).toThrow(STORAGE_DISABLED_MESSAGE);
	});
});

/** The single file under uploads/, so a test does not have to spell out today's date. */
async function onlyUploadPath(): Promise<string> {
	const [object] = await findUserFiles(userScope, (relativePath) => relativePath.startsWith('uploads/'));
	return object.key.replace('projects/proj-1/users/user-1/', '');
}

function useSizeLimit(megabytes: number): void {
	process.env.NAO_STORAGE_MAX_FILE_SIZE_MB = String(megabytes);
	__reloadEnvForTesting();
}

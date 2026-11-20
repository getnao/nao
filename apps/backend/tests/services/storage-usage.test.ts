import { describe, expect, it } from 'vitest';

import { getProjectUsageByUser, getScopeUsage } from '../../src/services/storage/usage';
import { writeUserFile } from '../../src/services/storage/user-files';
import { otherUserScope, userScope, useStorageBackend, useTemporaryLocalStorage } from '../helpers/storage-backend';

const otherProjectScope = { projectId: 'proj-2', userId: 'user-1' };

useTemporaryLocalStorage();

describe('getScopeUsage', () => {
	it('counts every file of the user, at any depth', async () => {
		await writeUserFile(userScope, 'notes.md', 'ab');
		await writeUserFile(userScope, 'reports/2025/q1.csv', 'abcd');

		expect(await getScopeUsage(userScope)).toEqual({ fileCount: 2, totalBytes: 6 });
	});

	it('ignores files of other users and other projects', async () => {
		await writeUserFile(otherUserScope, 'theirs.csv', 'abcd');
		await writeUserFile(otherProjectScope, 'elsewhere.csv', 'abcd');

		expect(await getScopeUsage(userScope)).toEqual({ fileCount: 0, totalBytes: 0 });
	});

	it('reports an empty space when storage is disabled', async () => {
		useStorageBackend('none');
		expect(await getScopeUsage(userScope)).toEqual({ fileCount: 0, totalBytes: 0 });
	});
});

describe('getProjectUsageByUser', () => {
	it('groups the project by user, heaviest space first', async () => {
		await writeUserFile(userScope, 'notes.md', 'ab');
		await writeUserFile(otherUserScope, 'reports/q1.csv', 'abcd');
		await writeUserFile(otherUserScope, 'reports/q2.csv', 'a');

		expect(await getProjectUsageByUser('proj-1')).toEqual([
			{ userId: 'user-2', fileCount: 2, totalBytes: 5 },
			{ userId: 'user-1', fileCount: 1, totalBytes: 2 },
		]);
	});

	it('leaves out other projects', async () => {
		await writeUserFile(otherProjectScope, 'elsewhere.csv', 'abcd');
		expect(await getProjectUsageByUser('proj-1')).toEqual([]);
	});

	it('reports nothing when storage is disabled', async () => {
		useStorageBackend('none');
		expect(await getProjectUsageByUser('proj-1')).toEqual([]);
	});
});

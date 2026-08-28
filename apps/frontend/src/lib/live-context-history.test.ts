import { describe, expect, it } from 'vitest';

import { formatChangedFileCount, getHiddenPullFileCount, getVisiblePullFiles } from './live-context-history';

describe('live context pull history', () => {
	it.each([
		[0, '0 files changed'],
		[1, '1 file changed'],
		[2, '2 files changed'],
	])('pluralizes %i changed files', (count, expected) => {
		expect(formatChangedFileCount(count)).toBe(expected);
	});

	it('shows three files initially and all files when expanded', () => {
		const files = ['/one', '/two', '/three', '/four', '/five'];

		expect(getVisiblePullFiles(files, false)).toEqual(files.slice(0, 3));
		expect(getVisiblePullFiles(files, true)).toEqual(files);
		expect(getHiddenPullFileCount(files.length)).toBe(2);
		expect(getHiddenPullFileCount(2)).toBe(0);
	});
});

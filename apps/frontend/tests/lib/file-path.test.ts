import { describe, expect, it } from 'vitest';

import { getDistinguishingFolders } from '@/lib/file-path';

describe('getDistinguishingFolders', () => {
	it.each([
		{
			case: 'gives no folder to files with a unique name',
			paths: ['/docs/a.md', '/docs/b.md'],
			expected: {},
		},
		{
			case: 'tells files of the same name apart by their parent folder',
			paths: ['/docs/orders/columns.md', '/docs/customers/columns.md', '/docs/readme.md'],
			expected: { '/docs/orders/columns.md': 'orders', '/docs/customers/columns.md': 'customers' },
		},
		{
			case: 'goes up the folders until they differ, showing key=value folders by their value',
			paths: [
				'/databases/schema=public/table=orders/columns.md',
				'/databases/schema=staging/table=orders/columns.md',
				'/databases/schema=public/table=users/columns.md',
			],
			expected: {
				'/databases/schema=public/table=orders/columns.md': 'public/orders',
				'/databases/schema=staging/table=orders/columns.md': 'staging/orders',
				'/databases/schema=public/table=users/columns.md': 'users',
			},
		},
		{
			case: 'shows every folder of a file nested in a namesake folder',
			paths: ['/a/notes.md', '/b/a/notes.md'],
			expected: { '/a/notes.md': 'a', '/b/a/notes.md': 'b/a' },
		},
	])('$case', ({ paths, expected }) => {
		expect(Object.fromEntries(getDistinguishingFolders(paths))).toEqual(expected);
	});
});

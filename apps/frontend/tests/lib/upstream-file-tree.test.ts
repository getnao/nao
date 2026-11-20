import { describe, expect, it } from 'vitest';

import type { FileTreeEntry } from '@nao/shared/types';
import { addBranchFiles } from '@/lib/upstream-file-tree';

const PRODUCTION_TREE: FileTreeEntry[] = [
	{
		name: 'tests',
		path: '/tests',
		type: 'directory',
		children: [
			{
				name: 'business',
				path: '/tests/business',
				type: 'directory',
				children: [{ name: 'orders.yml', path: '/tests/business/orders.yml', type: 'file' }],
			},
			{ name: 'total.yml', path: '/tests/total.yml', type: 'file' },
		],
	},
	{ name: 'RULES.md', path: '/RULES.md', type: 'file' },
];

describe('addBranchFiles', () => {
	it('adds the files of the branch in sorted position, with the folders holding them', () => {
		const tree = addBranchFiles(PRODUCTION_TREE, ['tests/business/margin.yml', 'repos/business/metrics/net.md']);

		expect(listPaths(tree)).toEqual([
			'/repos',
			'/repos/business',
			'/repos/business/metrics',
			'/repos/business/metrics/net.md',
			'/tests',
			'/tests/business',
			'/tests/business/margin.yml',
			'/tests/business/orders.yml',
			'/tests/total.yml',
			'/RULES.md',
		]);
	});

	it('leaves the production tree as it is', () => {
		const before = JSON.stringify(PRODUCTION_TREE);

		addBranchFiles(PRODUCTION_TREE, ['tests/business/margin.yml', 'tests/total.yml']);

		expect(JSON.stringify(PRODUCTION_TREE)).toBe(before);
	});
});

function listPaths(entries: FileTreeEntry[]): string[] {
	return entries.flatMap((entry) => [entry.path, ...listPaths(entry.children ?? [])]);
}

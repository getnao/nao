import { describe, expect, it } from 'vitest';

import {
	getAutoExpandKeys,
	getSingleChildFolderChain,
	getTreeNodePadding,
	removeExpandedSubtree,
} from './tree-expansion';

interface TestNode {
	key: string;
	folder: boolean;
	children?: TestNode[];
}

const adapter = {
	getKey: (node: TestNode) => node.key,
	getChildren: (node: TestNode) => node.children ?? [],
	isFolder: (node: TestNode) => node.folder,
};

describe('tree expansion', () => {
	it('expands single-child folder chains until a branch or leaf', () => {
		const tree: TestNode = {
			key: 'root',
			folder: true,
			children: [
				{
					key: 'schema',
					folder: true,
					children: [{ key: 'table', folder: false }],
				},
			],
		};

		expect(getSingleChildFolderChain(tree, adapter).map((node) => node.key)).toEqual(['root', 'schema']);
		expect(getAutoExpandKeys(tree, adapter)).toEqual(['root', 'schema']);

		tree.children = [
			{ key: 'public', folder: true },
			{ key: 'audit', folder: true },
		];
		expect(getAutoExpandKeys(tree, adapter)).toEqual(['root']);
	});

	it('supports falsey node values', () => {
		const booleanAdapter = {
			getKey: (node: boolean) => String(node),
			getChildren: () => [] as boolean[],
			isFolder: () => true,
		};

		expect(getSingleChildFolderChain(false, booleanAdapter)).toEqual([false]);
		expect(getAutoExpandKeys(false, booleanAdapter)).toEqual(['false']);
	});

	it('removes a folder and all expanded descendants', () => {
		const expanded = new Set(['root', 'root/schema', 'root/schema/nested', 'unrelated']);

		removeExpandedSubtree(expanded, 'root', '/');

		expect([...expanded]).toEqual(['unrelated']);
	});

	it('uses the shared tree indentation rhythm', () => {
		expect(getTreeNodePadding(0)).toBe(8);
		expect(getTreeNodePadding(1)).toBe(24);
		expect(getTreeNodePadding(2)).toBe(40);
	});
});

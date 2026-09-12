export interface TreeExpansionAdapter<Node> {
	getKey: (node: Node) => string;
	getChildren: (node: Node) => readonly Node[];
	isFolder: (node: Node) => boolean;
}

export function getSingleChildFolderChain<Node>(node: Node, adapter: TreeExpansionAdapter<Node>): Node[] {
	const folders: Node[] = [];
	let current: Node | undefined = node;

	while (current !== undefined && adapter.isFolder(current)) {
		folders.push(current);
		const children = adapter.getChildren(current);
		if (children.length !== 1 || !adapter.isFolder(children[0])) {
			break;
		}
		current = children[0];
	}

	return folders;
}

export function getAutoExpandKeys<Node>(node: Node, adapter: TreeExpansionAdapter<Node>): string[] {
	return getSingleChildFolderChain(node, adapter).map(adapter.getKey);
}

export function removeExpandedSubtree(expandedKeys: Set<string>, rootKey: string, separator: string): void {
	const descendantPrefix = `${rootKey}${separator}`;

	for (const key of expandedKeys) {
		if (key === rootKey || key.startsWith(descendantPrefix)) {
			expandedKeys.delete(key);
		}
	}
}

export function getTreeNodePadding(depth: number): number {
	return depth * 16 + 8;
}

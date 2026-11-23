import type { FileTreeEntry } from '@nao/shared/types';

/** Adds the files a synced repository branch creates to the production tree, with the folders holding them. */
export function addBranchFiles(entries: FileTreeEntry[], addedPaths: string[]): FileTreeEntry[] {
	return addedPaths.reduce((tree, addedPath) => addFile(tree, addedPath.split('/').filter(Boolean), ''), entries);
}

function addFile(entries: FileTreeEntry[], segments: string[], parentPath: string): FileTreeEntry[] {
	const [name, ...rest] = segments;
	if (!name) {
		return entries;
	}
	const entryPath = `${parentPath}/${name}`;
	const existing = entries.find((entry) => entry.name === name);
	if (rest.length === 0) {
		return existing ? entries : sortEntries([...entries, { name, path: entryPath, type: 'file' }]);
	}
	if (existing && existing.type !== 'directory') {
		return entries;
	}
	const folder: FileTreeEntry = existing ?? { name, path: entryPath, type: 'directory', children: [] };
	const updated = { ...folder, children: addFile(folder.children ?? [], rest, entryPath) };
	return sortEntries([...entries.filter((entry) => entry !== existing), updated]);
}

/** Folders first, then by name, like the tree the server lists. */
function sortEntries(entries: FileTreeEntry[]): FileTreeEntry[] {
	return entries.sort((left, right) =>
		left.type === right.type ? left.name.localeCompare(right.name) : left.type === 'directory' ? -1 : 1,
	);
}

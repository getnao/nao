import type { FileTreeEntry } from '@nao/shared/types';
import type { ContentMatch } from '@/components/settings/file-tree';

/** Folders first, then files, each alphabetically — the order the Settings file explorer uses. */
export function buildStoryFileTree(
	paths: string[],
	isReadOnly: (path: string) => boolean = () => false,
): FileTreeEntry[] {
	const root: FileTreeEntry[] = [];
	for (const path of paths) {
		insertPath(root, path.split('/'), '');
	}
	return markReadOnly(sortEntries(root), isReadOnly);
}

/** Case-insensitive, like the context explorer's content search: first matching line plus the match count. */
export function findContentMatches(
	files: { path: string; content: string }[],
	query: string,
): Map<string, ContentMatch> {
	const needle = query.toLowerCase();
	const matches = new Map<string, ContentMatch>();
	for (const file of files) {
		const lines = file.content.split('\n');
		const matchingLines = lines.flatMap((text, index) => (text.toLowerCase().includes(needle) ? [index] : []));
		if (matchingLines.length > 0) {
			const firstLine = matchingLines[0];
			matches.set(file.path, { count: matchingLines.length, line: firstLine + 1, text: lines[firstLine].trim() });
		}
	}
	return matches;
}

function insertPath(entries: FileTreeEntry[], segments: string[], parentPath: string): void {
	const [name, ...rest] = segments;
	const path = parentPath ? `${parentPath}/${name}` : name;
	if (rest.length === 0) {
		entries.push({ name, path, type: 'file' });
		return;
	}
	let directory = entries.find((entry) => entry.type === 'directory' && entry.name === name);
	if (!directory) {
		directory = { name, path, type: 'directory', children: [] };
		entries.push(directory);
	}
	insertPath(directory.children!, rest, path);
}

/** A folder is read-only when every file in it is; the lock then sits on the folder only, not on each file. */
function markReadOnly(entries: FileTreeEntry[], isReadOnly: (path: string) => boolean): FileTreeEntry[] {
	return entries.map((entry) => {
		if (!entry.children) {
			return isReadOnly(entry.path) ? { ...entry, readOnly: true } : entry;
		}
		const children = markReadOnly(entry.children, isReadOnly);
		if (children.length > 0 && children.every((child) => child.readOnly)) {
			return { ...entry, readOnly: true, children: children.map(withoutFileLock) };
		}
		return { ...entry, children };
	});
}

function withoutFileLock(entry: FileTreeEntry): FileTreeEntry {
	return entry.children ? entry : { ...entry, readOnly: undefined };
}

function sortEntries(entries: FileTreeEntry[]): FileTreeEntry[] {
	return entries
		.map((entry) => (entry.children ? { ...entry, children: sortEntries(entry.children) } : entry))
		.sort((left, right) =>
			left.type === right.type ? left.name.localeCompare(right.name) : left.type === 'directory' ? -1 : 1,
		);
}

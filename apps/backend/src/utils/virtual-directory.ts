import type { list } from '@nao/shared/tools';

interface VirtualFile {
	path: string;
	content: string;
}

/** Files directly under `directory`, plus one entry per sub-folder implied by deeper paths. */
export function entriesInVirtualDirectory(
	files: VirtualFile[],
	directory: string,
	toVirtualPath: (filePath: string) => string,
): list.Entry[] {
	const prefix = directory === '' ? '' : `${directory}/`;
	const subfolders = new Map<string, number>();
	const entries: list.Entry[] = [];

	for (const file of files) {
		if (!file.path.startsWith(prefix)) {
			continue;
		}
		const rest = file.path.slice(prefix.length);
		const [head, ...deeper] = rest.split('/');
		if (deeper.length === 0) {
			entries.push({
				path: toVirtualPath(file.path),
				name: head,
				type: 'file',
				size: String(Buffer.byteLength(file.content, 'utf8')),
			});
		} else {
			subfolders.set(head, (subfolders.get(head) ?? 0) + 1);
		}
	}

	const folderEntries = [...subfolders.entries()].map(([name, itemCount]) => ({
		path: toVirtualPath(`${prefix}${name}`),
		name,
		type: 'directory' as const,
		itemCount,
	}));
	return [...folderEntries, ...entries];
}

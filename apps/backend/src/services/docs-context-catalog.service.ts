import { normalizeDocsContextPath } from '@nao/shared';
import fs from 'fs';
import path from 'path';

import { shouldExcludeEntry } from '../utils/tools';

export interface DocsContextCatalogEntry {
	kind: 'folder' | 'file';
	path: string;
}

export type DocsContextCatalog = {
	syncState: 'missing' | 'ready';
	entries: DocsContextCatalogEntry[];
};

export function getDocsContextCatalog(projectFolder: string): DocsContextCatalog {
	const docsFolder = path.join(projectFolder, 'docs');
	let stats: fs.Stats;
	try {
		stats = fs.lstatSync(docsFolder);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return { syncState: 'missing', entries: [] };
		}
		throw error;
	}
	if (!stats.isDirectory() || stats.isSymbolicLink()) {
		return { syncState: 'missing', entries: [] };
	}

	return { syncState: 'ready', entries: scanDocsDirectory(docsFolder, '', projectFolder) };
}

function scanDocsDirectory(
	directory: string,
	relativeDirectory: string,
	projectFolder: string,
): DocsContextCatalogEntry[] {
	const entries = fs
		.readdirSync(directory, { withFileTypes: true })
		.filter(
			(entry) =>
				!entry.isSymbolicLink() &&
				!shouldExcludeEntry(
					entry.name,
					relativeDirectory ? `docs/${relativeDirectory}` : 'docs',
					projectFolder,
				),
		)
		.sort(
			(left, right) =>
				Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name),
		);

	return entries.flatMap((entry): DocsContextCatalogEntry[] => {
		const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
		if (normalizeDocsContextPath(relativePath) === null) {
			return [];
		}
		if (entry.isDirectory()) {
			return [
				{ kind: 'folder', path: relativePath },
				...scanDocsDirectory(path.join(directory, entry.name), relativePath, projectFolder),
			];
		}
		return entry.isFile() ? [{ kind: 'file', path: relativePath }] : [];
	});
}

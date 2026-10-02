import { normalizeFilesContextPath } from '@nao/shared';
import fs from 'fs';
import path from 'path';

import { shouldExcludeEntry } from '../utils/tools';

export interface FilesContextCatalogEntry {
	kind: 'folder' | 'file';
	path: string;
}

export type FilesContextCatalog = {
	syncState: 'missing' | 'ready';
	entries: FilesContextCatalogEntry[];
};

/** Roots granted by their own permission, never by the project-file grants. */
const SCOPED_ROOT_NAMES = new Set(['databases', 'docs']);

export function getFilesContextCatalog(projectFolder: string): FilesContextCatalog {
	let stats: fs.Stats;
	try {
		stats = fs.lstatSync(projectFolder);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return { syncState: 'missing', entries: [] };
		}
		throw error;
	}
	if (!stats.isDirectory() || stats.isSymbolicLink()) {
		return { syncState: 'missing', entries: [] };
	}

	return { syncState: 'ready', entries: scanFilesDirectory(projectFolder, '', projectFolder) };
}

function scanFilesDirectory(
	directory: string,
	relativeDirectory: string,
	projectFolder: string,
): FilesContextCatalogEntry[] {
	const entries = fs
		.readdirSync(directory, { withFileTypes: true })
		.filter(
			(entry) =>
				!entry.isSymbolicLink() &&
				!(relativeDirectory === '' && SCOPED_ROOT_NAMES.has(entry.name)) &&
				!shouldExcludeEntry(entry.name, relativeDirectory, projectFolder),
		)
		.sort(
			(left, right) =>
				Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name),
		);

	return entries.flatMap((entry): FilesContextCatalogEntry[] => {
		const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
		if (normalizeFilesContextPath(relativePath) === null) {
			return [];
		}
		if (entry.isDirectory()) {
			return [
				{ kind: 'folder', path: relativePath },
				...scanFilesDirectory(path.join(directory, entry.name), relativePath, projectFolder),
			];
		}
		return entry.isFile() ? [{ kind: 'file', path: relativePath }] : [];
	});
}

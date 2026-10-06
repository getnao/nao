import { CONTEXT_CONFIG_FILENAME, normalizeFileTreePath } from '@nao/shared';
import fs from 'fs';
import path from 'path';

import { shouldExcludeEntry } from '../utils/tools';

export interface FileTreeCatalogEntry {
	kind: 'folder' | 'file';
	path: string;
}

export type FileTreeCatalog = {
	syncState: 'missing' | 'ready';
	entries: FileTreeCatalogEntry[];
};

type FileTreeScope = {
	rootRelativePath: string;
	includesRootEntry: (entryName: string) => boolean;
};

/** Roots granted by their own permission, never by the project-file grants. */
const SCOPED_ROOT_NAMES = new Set(['databases', 'docs']);

const DOCS_SCOPE: FileTreeScope = { rootRelativePath: 'docs', includesRootEntry: () => true };
const PROJECT_FILES_SCOPE: FileTreeScope = {
	rootRelativePath: '',
	includesRootEntry: (entryName) => !SCOPED_ROOT_NAMES.has(entryName),
};

export function getDocsContextCatalog(projectFolder: string): FileTreeCatalog {
	return getFileTreeCatalog(projectFolder, DOCS_SCOPE);
}

export function getFilesContextCatalog(projectFolder: string): FileTreeCatalog {
	return getFileTreeCatalog(projectFolder, PROJECT_FILES_SCOPE);
}

function getFileTreeCatalog(projectFolder: string, scope: FileTreeScope): FileTreeCatalog {
	const rootFolder = path.join(projectFolder, scope.rootRelativePath);
	let stats: fs.Stats;
	try {
		stats = fs.lstatSync(rootFolder);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return { syncState: 'missing', entries: [] };
		}
		throw error;
	}
	if (!stats.isDirectory() || stats.isSymbolicLink()) {
		return { syncState: 'missing', entries: [] };
	}

	return { syncState: 'ready', entries: scanFileTreeDirectory(rootFolder, '', projectFolder, scope) };
}

/** The agent can never read `nao_config.yaml` wherever it lives, so a grant on it would be unusable. */
function isProjectConfigFile(entryName: string): boolean {
	return entryName.toLowerCase() === CONTEXT_CONFIG_FILENAME;
}

function scanFileTreeDirectory(
	directory: string,
	relativeDirectory: string,
	projectFolder: string,
	scope: FileTreeScope,
): FileTreeCatalogEntry[] {
	const projectRelativeDirectory = [scope.rootRelativePath, relativeDirectory].filter(Boolean).join('/');
	const entries = fs
		.readdirSync(directory, { withFileTypes: true })
		.filter(
			(entry) =>
				!entry.isSymbolicLink() &&
				!isProjectConfigFile(entry.name) &&
				(relativeDirectory !== '' || scope.includesRootEntry(entry.name)) &&
				!shouldExcludeEntry(entry.name, projectRelativeDirectory, projectFolder),
		)
		.sort(
			(left, right) =>
				Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name),
		);

	return entries.flatMap((entry): FileTreeCatalogEntry[] => {
		const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
		if (normalizeFileTreePath(relativePath) !== relativePath) {
			return [];
		}
		if (entry.isDirectory()) {
			return [
				{ kind: 'folder', path: relativePath },
				...scanFileTreeDirectory(path.join(directory, entry.name), relativePath, projectFolder, scope),
			];
		}
		return entry.isFile() ? [{ kind: 'file', path: relativePath }] : [];
	});
}

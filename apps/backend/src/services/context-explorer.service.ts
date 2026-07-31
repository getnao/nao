import type { FileTreeEntry } from '@nao/shared/types';
import fs from 'fs/promises';
import path from 'path';

import { shouldExcludeEntry } from '../utils/tools';

export async function getFileTree(projectFolder: string): Promise<FileTreeEntry[]> {
	return readDirectoryRecursive(projectFolder, projectFolder);
}

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

export async function readFileContent(filePath: string, projectFolder: string): Promise<string> {
	const realPath = resolveAndValidatePath(filePath, projectFolder);
	const stat = await fs.stat(realPath);

	if (!stat.isFile()) {
		throw new Error('Path is not a file');
	}

	if (stat.size > MAX_FILE_SIZE) {
		throw new Error('File is too large to display (max 1 MB)');
	}

	return fs.readFile(realPath, 'utf-8');
}

export async function writeFileContent(filePath: string, projectFolder: string, content: string): Promise<void> {
	const realPath = resolveAndValidatePath(filePath, projectFolder);
	const stat = await fs.stat(realPath);

	if (!stat.isFile()) {
		throw new Error('Path is not a file');
	}

	if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
		throw new Error('File is too large to save (max 1 MB)');
	}

	await fs.writeFile(realPath, content, 'utf-8');
}

async function readDirectoryRecursive(dirPath: string, projectFolder: string): Promise<FileTreeEntry[]> {
	const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });

	const parentRelativePath = path.relative(projectFolder, dirPath);
	const filtered = dirEntries.filter((entry) => !shouldExcludeEntry(entry.name, parentRelativePath, projectFolder));

	const entries: FileTreeEntry[] = [];

	for (const entry of filtered) {
		const fullPath = path.join(dirPath, entry.name);
		const virtualPath = '/' + path.relative(projectFolder, fullPath);

		if (entry.isDirectory()) {
			const children = await readDirectoryRecursive(fullPath, projectFolder);
			entries.push({
				name: entry.name,
				path: virtualPath,
				type: 'directory',
				children,
			});
		} else if (entry.isFile()) {
			entries.push({
				name: entry.name,
				path: virtualPath,
				type: 'file',
			});
		}
	}

	entries.sort((a, b) => {
		if (a.type === b.type) {
			return a.name.localeCompare(b.name);
		}
		return a.type === 'directory' ? -1 : 1;
	});

	return entries;
}

function resolveAndValidatePath(virtualPath: string, projectFolder: string): string {
	const relativePath = virtualPath.startsWith('/') ? virtualPath.slice(1) : virtualPath;
	const resolvedProjectFolder = path.resolve(projectFolder);
	const resolvedPath = path.resolve(resolvedProjectFolder, relativePath);

	const withinFolder =
		resolvedPath === resolvedProjectFolder || resolvedPath.startsWith(resolvedProjectFolder + path.sep);
	if (!withinFolder) {
		throw new Error(`Access denied: path is outside the project folder`);
	}

	return resolvedPath;
}

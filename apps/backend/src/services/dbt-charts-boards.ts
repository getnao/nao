import { type Dirent, existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import yaml from 'js-yaml';

const BOARD_FILE_PATTERN = /\.ya?ml$/i;
const CHARTS_FOLDER = 'charts';
const PARTIALS_FOLDER = 'partials';
const SKIPPED_FOLDERS = new Set(['.git', '.meta', 'node_modules', 'target', 'dbt_packages', 'agent']);
const MAX_SCAN_DEPTH = 3;

export interface ProjectBoard {
	/** Path of the YAML file relative to the project root, using `/` separators. */
	path: string;
	title: string;
	updatedAt: Date;
}

export interface ProjectBoardContent extends ProjectBoard {
	yaml: string;
}

export function listProjectBoards(projectFolder: string): ProjectBoard[] {
	const projectRoot = resolveProjectRoot(projectFolder);
	if (!projectRoot) {
		return [];
	}
	return findChartsFolders(projectRoot)
		.flatMap((chartsFolder) => listBoardsInFolder(projectRoot, chartsFolder))
		.sort((a, b) => a.path.localeCompare(b.path));
}

export function readProjectBoard(projectFolder: string, boardPath: string): ProjectBoardContent | null {
	const projectRoot = resolveProjectRoot(projectFolder);
	if (!projectRoot || !BOARD_FILE_PATTERN.test(boardPath)) {
		return null;
	}
	const filePath = join(projectRoot, ...boardPath.split('/'));
	const source = readContainedFile(projectRoot, filePath);
	if (source === null) {
		return null;
	}
	return {
		path: boardPath,
		title: extractBoardTitle(source, boardPath),
		yaml: source,
		updatedAt: fileUpdatedAt(filePath),
	};
}

export function extractBoardTitle(boardYaml: string, fallbackPath: string): string {
	try {
		const parsed = yaml.load(boardYaml);
		const title = parsed && typeof parsed === 'object' ? (parsed as { title?: unknown }).title : undefined;
		if (typeof title === 'string' && title.trim()) {
			return title.trim();
		}
	} catch {
		/* invalid YAML still deserves a listing entry so the user can fix it */
	}
	return titleFromPath(fallbackPath);
}

function resolveProjectRoot(projectFolder: string): string | null {
	try {
		return realpathSync(projectFolder);
	} catch {
		return null;
	}
}

function findChartsFolders(root: string, depth = 0): string[] {
	if (depth > MAX_SCAN_DEPTH) {
		return [];
	}
	let entries: Dirent[];
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter((entry) => entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name) && !entry.name.startsWith('.'))
		.flatMap((entry) => {
			const folder = join(root, entry.name);
			if (entry.name === CHARTS_FOLDER) {
				return [folder];
			}
			return findChartsFolders(folder, depth + 1);
		});
}

function listBoardsInFolder(projectRoot: string, chartsFolder: string): ProjectBoard[] {
	return walkBoardFiles(chartsFolder).flatMap((filePath) => {
		const source = readContainedFile(projectRoot, filePath);
		if (source === null) {
			return [];
		}
		const boardPath = relative(projectRoot, filePath).split(sep).join('/');
		return [{ path: boardPath, title: extractBoardTitle(source, boardPath), updatedAt: fileUpdatedAt(filePath) }];
	});
}

function walkBoardFiles(folder: string): string[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(folder, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const entryPath = join(folder, entry.name);
		if (entry.isDirectory()) {
			return entry.name === PARTIALS_FOLDER || entry.name.startsWith('.') ? [] : walkBoardFiles(entryPath);
		}
		return entry.isFile() && BOARD_FILE_PATTERN.test(entry.name) ? [entryPath] : [];
	});
}

function readContainedFile(folder: string, filePath: string): string | null {
	try {
		if (!existsSync(filePath)) {
			return null;
		}
		const stats = lstatSync(filePath);
		if (!stats.isFile() || stats.isSymbolicLink()) {
			return null;
		}
		const canonicalPath = realpathSync(filePath);
		if (!isContainedBy(folder, canonicalPath)) {
			return null;
		}
		return readFileSync(canonicalPath, 'utf8');
	} catch {
		return null;
	}
}

function fileUpdatedAt(filePath: string): Date {
	try {
		return lstatSync(filePath).mtime;
	} catch {
		return new Date(0);
	}
}

function isContainedBy(folder: string, target: string): boolean {
	const pathFromFolder = relative(folder, target);
	return pathFromFolder !== '' && !pathFromFolder.startsWith('..') && !isAbsolute(pathFromFolder);
}

function titleFromPath(boardPath: string): string {
	const fileName = boardPath.split('/').pop() ?? boardPath;
	return fileName
		.replace(BOARD_FILE_PATTERN, '')
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, (character) => character.toUpperCase());
}

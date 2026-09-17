import fs from 'node:fs/promises';
import path from 'node:path';

import { fileExtension } from '@nao/shared/attachments';

import { shouldExcludeEntry, toRealPath, toVirtualPath } from '../../utils/tools';

export const MAX_CANDIDATES = 2_000;
const EXCERPT_CHARS = 160;
const EXCERPT_READ_BYTES = 4_096;
const TABLE_FOLDER_PREFIX = 'table=';
const TABLE_ANNOTATIONS_FILE = 'annotations.md';
const TABLE_COLUMNS_FILE = 'columns.md';
const SKIPPED_DIRECTORIES = new Set(['node_modules', '__pycache__', 'target']);
const TEXT_EXTENSIONS = new Set([
	'md',
	'mdx',
	'txt',
	'rst',
	'yaml',
	'yml',
	'json',
	'jsonl',
	'sql',
	'csv',
	'tsv',
	'toml',
	'py',
]);
const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;

/**
 * One rankable unit of project context. A table folder (`table=<name>/`) counts as a single
 * candidate described by its annotations and columns, so sibling files do not split its score.
 */
export interface ContextCandidate {
	id: string;
	path: string;
	type: 'file' | 'directory';
	excerpt: string;
	realPath: string;
}

export async function collectContextCandidates(
	virtualFolder: string,
	projectFolder: string,
	limit = MAX_CANDIDATES,
): Promise<ContextCandidate[]> {
	const root = toRealPath(virtualFolder, projectFolder);
	await assertDirectory(root, virtualFolder);

	const entries = await walk(root, projectFolder, limit);
	entries.sort((left, right) => left.path.localeCompare(right.path));
	return entries.map((entry, index) => ({ ...entry, id: candidateId(index) }));
}

/** A longer description of a candidate, for re-reading a shortlist against the query. */
export async function readCandidateExcerpt(candidate: ContextCandidate, maxChars: number): Promise<string> {
	const text =
		candidate.type === 'directory'
			? await describeTable(candidate.realPath, maxChars * 4)
			: await readHead(candidate.realPath, maxChars * 4);
	return normalizeExcerpt(text, maxChars);
}

type UnidentifiedCandidate = Omit<ContextCandidate, 'id'>;

async function walk(root: string, projectFolder: string, limit: number): Promise<UnidentifiedCandidate[]> {
	const found: UnidentifiedCandidate[] = [];
	const pending = [root];

	while (pending.length > 0 && found.length < limit) {
		const directory = pending.shift()!;
		const entries = await fs.readdir(directory, { withFileTypes: true });
		const parentRelativePath = path.relative(projectFolder, directory);

		for (const entry of entries) {
			if (found.length >= limit) {
				break;
			}
			const realPath = path.join(directory, entry.name);
			if (entry.name.startsWith('.') || shouldExcludeEntry(entry.name, parentRelativePath, projectFolder)) {
				continue;
			}
			if (entry.isDirectory()) {
				if (entry.name.startsWith(TABLE_FOLDER_PREFIX)) {
					found.push(await tableCandidate(realPath, projectFolder));
				} else if (!SKIPPED_DIRECTORIES.has(entry.name)) {
					pending.push(realPath);
				}
			} else if (entry.isFile() && TEXT_EXTENSIONS.has(fileExtension(entry.name))) {
				found.push(await fileCandidate(realPath, projectFolder));
			}
		}
	}

	return found;
}

async function fileCandidate(realPath: string, projectFolder: string): Promise<UnidentifiedCandidate> {
	return {
		path: toVirtualPath(realPath, projectFolder),
		type: 'file',
		excerpt: normalizeExcerpt(await readHead(realPath, EXCERPT_READ_BYTES), EXCERPT_CHARS),
		realPath,
	};
}

async function tableCandidate(realPath: string, projectFolder: string): Promise<UnidentifiedCandidate> {
	return {
		path: toVirtualPath(realPath, projectFolder),
		type: 'directory',
		excerpt: normalizeExcerpt(await describeTable(realPath, EXCERPT_READ_BYTES), EXCERPT_CHARS),
		realPath,
	};
}

/** Human annotations are authoritative, so they come first; the generated columns file follows. */
async function describeTable(tableFolder: string, maxBytes: number): Promise<string> {
	const [annotations, columns] = await Promise.all([
		readHead(path.join(tableFolder, TABLE_ANNOTATIONS_FILE), maxBytes),
		readHead(path.join(tableFolder, TABLE_COLUMNS_FILE), maxBytes),
	]);
	return [stripFrontmatter(annotations), stripFrontmatter(columns)].filter(Boolean).join('\n');
}

async function readHead(realPath: string, maxBytes: number): Promise<string> {
	let handle: fs.FileHandle | undefined;
	try {
		handle = await fs.open(realPath, 'r');
		const buffer = Buffer.alloc(maxBytes);
		const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
		return buffer.subarray(0, bytesRead).toString('utf-8');
	} catch {
		return '';
	} finally {
		await handle?.close();
	}
}

function normalizeExcerpt(text: string, maxChars: number): string {
	const collapsed = stripFrontmatter(text).replace(/\s+/g, ' ').trim();
	return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars - 1)}…` : collapsed;
}

function stripFrontmatter(text: string): string {
	return text.replace(FRONTMATTER_PATTERN, '');
}

function candidateId(index: number): string {
	return `F${String(index + 1).padStart(4, '0')}`;
}

async function assertDirectory(realPath: string, virtualFolder: string): Promise<void> {
	const stats = await fs.stat(realPath).catch(() => null);
	if (!stats?.isDirectory()) {
		throw new Error(`'${virtualFolder}' is not a folder of the project.`);
	}
}

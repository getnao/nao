import fs from 'node:fs';

import type {
	ContextChangedFile,
	ContextFileDiff,
	FileContentSearchResponse,
	FileContentSearchResult,
	FileTreeEntry,
} from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import type { DBContextDraftFile } from '../db/abstractSchema';
import type { DraftOwner } from '../queries/context-draft.queries';
import * as contextDraftQueries from '../queries/context-draft.queries';
import { normalizeProjectPath, resolveContextRepository } from '../utils/context-repo';
import {
	compareTreeEntries,
	getFileTree,
	hashContent,
	readValidatedContextFileSync,
	resolveAndValidatePath,
	searchFileContents,
} from './context-explorer.service';
import { type DraftSource, isProductionOnly, readRegularFile } from './draft-context.service';

const MAX_MATCHED_LINES_PER_FILE = 10;

/**
 * Without a context repository, the File Explorer has no worktree to save to, so nao keeps each user's
 * edits as a draft until they are published.
 */
export async function hasContextRepository(projectId: string): Promise<boolean> {
	return (await resolveContextRepository(projectId)) !== null;
}

/** The live tree, plus the files the draft adds. */
export async function getNaoDraftFileTree(owner: DraftOwner, projectFolder: string): Promise<FileTreeEntry[]> {
	const [entries, files] = await Promise.all([getFileTree(projectFolder), contextDraftQueries.listDraftFiles(owner)]);
	for (const file of files.filter((draftFile) => draftFile.baseHash === null)) {
		insertFileEntry(entries, file.path.split('/'), '');
	}
	return entries;
}

/** Searches the live files with the draft's content in place of theirs, and the files the draft adds. */
export async function searchNaoDraftContents(
	owner: DraftOwner,
	projectFolder: string,
	query: string,
): Promise<FileContentSearchResponse> {
	const [liveSearch, files] = await Promise.all([
		searchFileContents(query, projectFolder),
		listSortedDraftFiles(owner),
	]);
	const draftPaths = new Set(files.map((file) => `/${file.path}`));
	const draftResults = files.flatMap((file) => {
		const result = searchText(`/${file.path}`, file.content, query);
		return result ? [result] : [];
	});
	return {
		results: [...liveSearch.results.filter((result) => !draftPaths.has(result.path)), ...draftResults],
		truncated: liveSearch.truncated,
	};
}

export async function listNaoDraftChanges(owner: DraftOwner): Promise<ContextChangedFile[]> {
	const files = await listSortedDraftFiles(owner);
	return files.map(toChangedFile);
}

export async function getNaoDraftFileDiff(
	owner: DraftOwner,
	projectFolder: string,
	filePath: string,
): Promise<ContextFileDiff> {
	const file = await contextDraftQueries.getDraftFile(owner, normalizeProjectPath(filePath));
	if (!file) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'This file has no changes.' });
	}
	return {
		...toChangedFile(file),
		oldContent: readLiveFile(projectFolder, filePath)?.toString('utf-8') ?? '',
		newContent: file.content,
	};
}

export async function discardNaoDraftFile(
	owner: DraftOwner,
	projectFolder: string,
	filePath: string,
): Promise<{ hash: string | null }> {
	const projectPath = normalizeProjectPath(filePath);
	const liveHash = readLiveHash(projectFolder, projectPath);
	await contextDraftQueries.deleteDraftFile(owner, projectPath);
	return { hash: liveHash };
}

export async function discardAllNaoDraftFiles(owner: DraftOwner): Promise<void> {
	await contextDraftQueries.deleteDraftFiles(owner);
}

export async function readNaoDraft(owner: DraftOwner, projectFolder: string): Promise<DraftSource> {
	const files = await listSortedDraftFiles(owner);
	const testedFiles = files.filter((file) => !isProductionOnly(file.path));
	const contents = new Map(testedFiles.map((file) => [file.path, Buffer.from(file.content, 'utf-8')]));
	return {
		context: {
			storage: 'nao',
			branch: null,
			productionBranch: null,
			productionCommit: null,
			changes: testedFiles.map(toContextChange),
			excludedChanges: files.filter((file) => isProductionOnly(file.path)).map(toContextChange),
			outdatedPaths: testedFiles
				.filter((file) => readLiveHash(projectFolder, file.path) !== file.baseHash)
				.map((file) => file.path),
		},
		readChangedFile: (projectPath) => contents.get(projectPath) ?? null,
	};
}

function insertFileEntry(entries: FileTreeEntry[], segments: string[], parentPath: string): void {
	const [name, ...childSegments] = segments;
	const entryPath = `${parentPath}/${name}`;
	const existing = entries.find((entry) => entry.name === name);
	if (childSegments.length === 0) {
		if (!existing) {
			entries.push({ name, path: entryPath, type: 'file' });
			entries.sort(compareTreeEntries);
		}
		return;
	}
	if (existing?.type === 'file') {
		return;
	}
	const directory = existing ?? { name, path: entryPath, type: 'directory' as const, children: [] };
	if (!existing) {
		entries.push(directory);
		entries.sort(compareTreeEntries);
	}
	directory.children ??= [];
	insertFileEntry(directory.children, childSegments, entryPath);
}

async function listSortedDraftFiles(owner: DraftOwner): Promise<DBContextDraftFile[]> {
	const files = await contextDraftQueries.listDraftFiles(owner);
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function toChangedFile(file: DBContextDraftFile): ContextChangedFile {
	return {
		path: `/${file.path}`,
		kind: file.baseHash ? 'modified' : 'untracked',
		additions: null,
		deletions: null,
	};
}

function toContextChange(file: DBContextDraftFile) {
	return { path: file.path, kind: file.baseHash ? ('modified' as const) : ('added' as const) };
}

/** Matches like the ripgrep search of the live files: case-insensitive, counted over the first matching lines. */
function searchText(virtualPath: string, content: string, query: string): FileContentSearchResult | null {
	const needle = query.toLowerCase();
	const matchingLines = content
		.split('\n')
		.map((text, index) => ({ text, line: index + 1, count: countOccurrences(text.toLowerCase(), needle) }))
		.filter((line) => line.count > 0)
		.slice(0, MAX_MATCHED_LINES_PER_FILE);
	const [first] = matchingLines;
	if (!first) {
		return null;
	}
	return {
		path: virtualPath,
		count: matchingLines.reduce((total, line) => total + line.count, 0),
		line: first.line,
		text: first.text.trim(),
	};
}

function countOccurrences(text: string, needle: string): number {
	let count = 0;
	for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + needle.length)) {
		count++;
	}
	return count;
}

function readLiveHash(projectFolder: string, projectPath: string): string | null {
	const content = readRegularFile(projectFolder, projectPath);
	return content ? hashContent(content) : null;
}

function readLiveFile(projectFolder: string, filePath: string): Buffer | null {
	const { realPath } = resolveAndValidatePath(filePath, projectFolder);
	return fs.existsSync(realPath) ? readValidatedContextFileSync(realPath, filePath) : null;
}

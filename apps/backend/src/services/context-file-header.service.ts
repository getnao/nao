import {
	type ContextFileHeaderProblems,
	type ContextFileHeaderReading,
	type ContextFileOwner,
	findContextTableFolder,
	isContextFileHeaderEditable,
	isSameContextFileOwner,
	readContextFileHeader,
	updateContextFileHeader,
	validateContextFileHeader,
} from '@nao/shared/context-file-header';
import type { FileContentResponse, FileTreeEntry } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import * as projectQueries from '../queries/project.queries';
import { normalizeProjectPath } from '../utils/context-repo';
import {
	type ContextExplorerFileAccess,
	getFileTree,
	readFileContent,
	readFileHeads,
	writeFileContent,
} from './context-explorer.service';
import { getNaoDraftFileTree, hasContextRepository } from './nao-draft.service';

const MARKDOWN_PATH_PATTERN = /\.(md|mdx|markdown)$/i;

export interface TableFileOwner {
	path: string;
	owner: string | null;
	/** False when the file is read-only here or its header cannot be read, so its owner cannot be changed. */
	isEditable: boolean;
}

interface TableFile {
	path: string;
	file: FileContentResponse;
	reading: ContextFileHeaderReading;
}

export async function listContextFileOwners(projectId: string): Promise<ContextFileOwner[]> {
	const users = await projectQueries.listUsersWithProjectAccess(projectId);
	return users
		.map(({ id, name, email }) => ({ id, name, email }))
		.sort((first, second) => first.name.localeCompare(second.name));
}

/** The Markdown files of the context whose header is broken or names an owner who is not a user of the project. */
export async function listContextFileHeaderProblems(
	projectId: string,
	access: ContextExplorerFileAccess,
): Promise<ContextFileHeaderProblems[]> {
	const [paths, owners] = await Promise.all([listMarkdownPaths(projectId, access), listContextFileOwners(projectId)]);
	const userEmails = new Set(owners.map((owner) => owner.email.toLowerCase()));
	const files = await readFileHeads(paths, access);
	return files.flatMap(({ path, content }) => {
		const problems = validateContextFileHeader(content, { filePath: path, userEmails });
		return problems.length > 0 ? [{ path, problems }] : [];
	});
}

/** The owner of each other Markdown file of the table the file documents. */
export async function listTableFileOwners(
	projectId: string,
	filePath: string,
	access: ContextExplorerFileAccess,
): Promise<TableFileOwner[]> {
	const tableFiles = await readOtherTableFiles(projectId, filePath, access);
	return tableFiles.map(({ path, file, reading }) => ({
		path,
		owner: reading.header.owner,
		isEditable: canChangeOwner(file, reading),
	}));
}

/**
 * Gives the other Markdown files of the table the file documents the same owner, so the whole table has one owner.
 * Files that cannot be edited here keep theirs.
 */
export async function applyOwnerToTableFiles(
	projectId: string,
	filePath: string,
	owner: string | null,
	access: ContextExplorerFileAccess,
): Promise<{ updatedPaths: string[] }> {
	const tableFiles = await readOtherTableFiles(projectId, filePath, access);
	const filesToUpdate = tableFiles.filter(
		({ file, reading }) => canChangeOwner(file, reading) && !isSameContextFileOwner(reading.header.owner, owner),
	);
	for (const { path, file } of filesToUpdate) {
		await writeFileContent(path, updateContextFileHeader(file.content, { owner }), file.hash, access);
	}
	return { updatedPaths: filesToUpdate.map(({ path }) => path) };
}

async function readOtherTableFiles(
	projectId: string,
	filePath: string,
	access: ContextExplorerFileAccess,
): Promise<TableFile[]> {
	const tableFolder = findContextTableFolder(filePath);
	if (!tableFolder) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'This file does not document a table.' });
	}
	const ownPath = normalizeProjectPath(filePath);
	const paths = (await listMarkdownPaths(projectId, access)).filter(
		(path) => findContextTableFolder(path)?.path === tableFolder.path && normalizeProjectPath(path) !== ownPath,
	);
	return Promise.all(
		paths.map(async (path) => {
			const file = await readFileContent(path, access);
			return { path, file, reading: readContextFileHeader(file.content) };
		}),
	);
}

function canChangeOwner(file: FileContentResponse, reading: ContextFileHeaderReading): boolean {
	return file.isEditable && isContextFileHeaderEditable(reading);
}

async function listMarkdownPaths(projectId: string, access: ContextExplorerFileAccess): Promise<string[]> {
	const entries = (await hasContextRepository(projectId))
		? await getFileTree(access.projectFolder)
		: await getNaoDraftFileTree(access.draftOwner, access.projectFolder);
	return collectMarkdownPaths(entries);
}

function collectMarkdownPaths(entries: FileTreeEntry[]): string[] {
	return entries.flatMap((entry) => {
		if (entry.type === 'directory') {
			return collectMarkdownPaths(entry.children ?? []);
		}
		return MARKDOWN_PATH_PATTERN.test(entry.path) ? [entry.path] : [];
	});
}

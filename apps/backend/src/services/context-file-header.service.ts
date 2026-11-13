import {
	type ContextFileHeaderProblems,
	type ContextFileOwner,
	validateContextFileHeader,
} from '@nao/shared/context-file-header';
import type { FileTreeEntry } from '@nao/shared/types';

import * as projectQueries from '../queries/project.queries';
import { type ContextExplorerFileAccess, getFileTree, readFileHeads } from './context-explorer.service';
import { getNaoDraftFileTree, hasContextRepository } from './nao-draft.service';

const MARKDOWN_PATH_PATTERN = /\.(md|mdx|markdown)$/i;

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

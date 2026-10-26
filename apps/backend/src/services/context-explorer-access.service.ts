import type { RepoProvider } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import * as userQueries from '../queries/user.queries';
import { resolveContextRepository, resolveContextSourceGitToken } from '../utils/context-repo';
import type { ContextExplorerFileAccess } from './context-explorer.service';
import {
	type ContextExplorerGitContext,
	resolveContextExplorerGit,
	resolveContextExplorerGitSafely,
} from './context-explorer-git.service';

interface ContextExplorerUser {
	id: string;
	name: string;
	email: string;
}

/** File access for reads: a git failure degrades to read-only instead of failing the request. */
export async function createSafeFileAccess(
	projectId: string,
	projectPath: string | null,
	user: ContextExplorerUser,
): Promise<ContextExplorerFileAccess> {
	const context = await createGitContext(projectId, projectPath, user);
	return {
		projectFolder: context.projectFolder,
		git: await resolveContextExplorerGitSafely(context),
	};
}

export async function createStrictFileAccess(
	projectId: string,
	projectPath: string | null,
	user: ContextExplorerUser,
): Promise<ContextExplorerFileAccess> {
	const context = await createGitContext(projectId, projectPath, user);
	return {
		projectFolder: context.projectFolder,
		git: await resolveContextExplorerGit(context),
	};
}

export async function createGitContext(
	projectId: string,
	projectPath: string | null,
	user: ContextExplorerUser,
): Promise<ContextExplorerGitContext> {
	if (!projectPath) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'No project path configured.' });
	}
	const repository = await resolveContextRepository(projectId);
	return {
		projectId,
		projectFolder: projectPath,
		userId: user.id,
		user: { name: user.name, email: user.email },
		token:
			repository?.provider === 'generic'
				? resolveContextSourceGitToken()
				: await getProviderToken(repository?.provider ?? 'github', user.id),
	};
}

export function getProviderToken(provider: RepoProvider, userId: string): Promise<string | null> {
	return provider === 'gitlab' ? userQueries.getGitlabToken(userId) : userQueries.getGithubToken(userId);
}

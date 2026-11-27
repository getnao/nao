import { TRPCError } from '@trpc/server';

import { resolveContextRepository } from '../utils/context-repo';
import type { ContextExplorerFileAccess } from './context-explorer.service';
import {
	type ContextExplorerGitContext,
	type ContextExplorerGitResolution,
	resolveContextExplorerGit,
	resolveContextExplorerGitSafely,
} from './context-explorer-git.service';
import { readManagedGithubRepositoryFullName } from './managed-github-repository';
import { resolveRepositoryProvider } from './shared-github-token.service';

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
	const git = await resolveContextExplorerGitSafely(context);
	return {
		projectFolder: context.projectFolder,
		git,
		draftOwner: { projectId, userId: user.id },
		managedRepository: await resolveManagedRepository(git, context),
	};
}

export async function createStrictFileAccess(
	projectId: string,
	projectPath: string | null,
	user: ContextExplorerUser,
): Promise<ContextExplorerFileAccess> {
	const context = await createGitContext(projectId, projectPath, user);
	const git = await resolveContextExplorerGit(context);
	return {
		projectFolder: context.projectFolder,
		git,
		draftOwner: { projectId, userId: user.id },
		managedRepository: await resolveManagedRepository(git, context),
	};
}

async function resolveManagedRepository(
	git: ContextExplorerGitResolution,
	context: ContextExplorerGitContext,
): Promise<ContextExplorerFileAccess['managedRepository']> {
	if (git.status !== 'unavailable' || git.reason !== 'no-repo') {
		return null;
	}
	const repoFullName = await readManagedGithubRepositoryFullName(context.projectFolder);
	return repoFullName ? { repoFullName, author: context.user } : null;
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
	const provider = await resolveRepositoryProvider(projectId, repository?.provider ?? 'github');
	return {
		projectId,
		projectFolder: projectPath,
		userId: user.id,
		user: { name: user.name, email: user.email },
		token: await provider.getToken(user.id),
		providerOverride: repository ? provider : undefined,
	};
}

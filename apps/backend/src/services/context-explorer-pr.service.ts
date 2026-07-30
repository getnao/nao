import {
	commitContextChanges,
	ContextExplorerGitContext,
	createContextBranchAndCommit,
	getChangedContextFiles,
	getContextBranches,
	pushContextBranch,
	requireContextExplorerGit,
} from './context-explorer-git.service';
import { REVIEW_REQUEST_PROVIDERS } from './review-request-provider';

export interface ContextPullRequestResult {
	url: string;
	branch: string;
	usedFallbackBase: boolean;
}

export async function createContextExplorerPullRequest(
	context: ContextExplorerGitContext,
	input: { paths: string[]; message: string; title: string; body?: string },
): Promise<ContextPullRequestResult> {
	const initial = await requireContextExplorerGit(context);
	const branches = getContextBranches(initial.repo);
	const changedPaths = new Set((await getChangedContextFiles(context)).map((file) => file.path));
	const selectedPathsAreCommitted = input.paths.every((filePath) => !changedPaths.has(normalizePath(filePath)));
	let usedFallbackBase = false;
	if (!branches.currentBranch || branches.currentBranch === branches.defaultBranch) {
		const commit = await createContextBranchAndCommit(context, {
			paths: input.paths,
			message: input.message,
		});
		usedFallbackBase = commit.usedFallbackBase;
	} else if (!selectedPathsAreCommitted) {
		await commitContextChanges(context, { paths: input.paths, message: input.message });
	}

	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const provider = availableContext.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	const { branch, defaultBranch } = pushContextBranch(repo, context.projectFolder, provider, availableContext.token);
	const result = await provider.openReviewRequest(availableContext.token, repo.repoFullName, {
		title: input.title,
		body: input.body ?? '',
		head: branch,
		base: defaultBranch,
	});
	return { url: result.url, branch, usedFallbackBase };
}

function normalizePath(filePath: string): string {
	return `/${filePath.replaceAll('\\', '/').replace(/^\/+/, '')}`;
}

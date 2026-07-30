import {
	ContextExplorerGitContext,
	getGithubContextRepositoryProvider,
	pushContextBranch,
	requireContextExplorerGit,
} from './context-explorer-git.service';
import * as github from './github';

export interface ContextPullRequestResult {
	url: string;
	branch: string;
}

export async function createContextExplorerPullRequest(
	context: ContextExplorerGitContext,
	input: { title: string; body?: string },
): Promise<ContextPullRequestResult> {
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const provider = availableContext.providerOverride ?? getGithubContextRepositoryProvider();
	const { branch, defaultBranch } = pushContextBranch(repo, context.projectFolder, provider, availableContext.token);
	const result = await github.createPullRequest(availableContext.token, repo.repoFullName, {
		title: input.title,
		body: input.body,
		head: branch,
		base: defaultBranch,
	});
	return { url: result.html_url, branch };
}

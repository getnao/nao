import { TRPCError } from '@trpc/server';

import {
	ContextExplorerGitContext,
	getContextBranchCommitMessages,
	getContextBranches,
	pushContextBranch,
	requireContextExplorerGit,
} from './context-explorer-git.service';
import { type OpenReviewRequestResult, REVIEW_REQUEST_PROVIDERS } from './review-request-provider';

export interface ContextPushResult {
	branch: string;
	reviewRequest: OpenReviewRequestResult | null;
}

export async function pushContextExplorerBranch(context: ContextExplorerGitContext): Promise<ContextPushResult> {
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const provider = availableContext.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	const branches = await getContextBranches(repo, context);
	const currentBranch = branches.currentBranch;
	if (!currentBranch || currentBranch === branches.defaultBranch) {
		throw nothingToPushError();
	}
	if (branches.aheadCommitCount === 0 && branches.unpushedCommitCount === 0) {
		throw nothingToPushError();
	}
	const existingReviewRequest = await provider.findOpenReviewRequest({
		token: availableContext.token,
		repoFullName: repo.repoFullName,
		branch: currentBranch,
		projectId: context.projectId,
		userId: context.userId,
	});
	if (branches.unpushedCommitCount === 0) {
		if (existingReviewRequest) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'Everything on this branch is already pushed.' });
		}
	}
	const commitMessages = getContextBranchCommitMessages(repo);
	const { branch, defaultBranch, pushOutput } = pushContextBranch(
		repo,
		context.projectFolder,
		provider,
		availableContext.token,
	);
	if (existingReviewRequest) {
		return { branch, reviewRequest: existingReviewRequest };
	}
	const result = await provider.openReviewRequest(availableContext.token, repo.repoFullName, {
		title: commitMessages[0] ?? 'Context updates',
		body: commitMessages.map((message) => `- ${message}`).join('\n'),
		head: branch,
		base: defaultBranch,
		requester: context.user,
		pushOutput,
	});
	if (result) {
		const branchOwnershipQueries = await import('../queries/context-branch-ownership.queries');
		await branchOwnershipQueries.setContextBranchReviewRequest(context.projectId, branch, context.userId, result);
	}
	return { branch, reviewRequest: result };
}

function nothingToPushError(): TRPCError {
	return new TRPCError({ code: 'BAD_REQUEST', message: 'This branch has nothing to push yet.' });
}

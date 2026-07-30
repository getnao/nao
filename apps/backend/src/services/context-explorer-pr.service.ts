import { TRPCError } from '@trpc/server';

import {
	ContextExplorerGitContext,
	getContextBranchCommitMessages,
	getContextBranches,
	pushContextBranch,
	requireContextExplorerGit,
} from './context-explorer-git.service';
import { REVIEW_REQUEST_PROVIDERS } from './review-request-provider';

export interface ContextPushResult {
	url: string;
	branch: string;
	reviewRequest: 'opened' | 'updated';
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
	const existingReviewRequest = await provider.findOpenReviewRequest(
		availableContext.token,
		repo.repoFullName,
		currentBranch,
	);
	if (branches.unpushedCommitCount === 0) {
		if (existingReviewRequest) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'Everything on this branch is already pushed.' });
		}
	}
	const commitMessages = getContextBranchCommitMessages(repo);
	const { branch, defaultBranch } = pushContextBranch(repo, context.projectFolder, provider, availableContext.token);
	if (existingReviewRequest) {
		return { url: existingReviewRequest.url, branch, reviewRequest: 'updated' };
	}
	const result = await provider.openReviewRequest(availableContext.token, repo.repoFullName, {
		title: commitMessages[0] ?? 'Context updates',
		body: commitMessages.map((message) => `- ${message}`).join('\n'),
		head: branch,
		base: defaultBranch,
	});
	return { url: result.url, branch, reviewRequest: 'opened' };
}

function nothingToPushError(): TRPCError {
	return new TRPCError({ code: 'BAD_REQUEST', message: 'This branch has nothing to push yet.' });
}

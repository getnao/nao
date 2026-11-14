import type { RepoBranch, RepoProvider } from '@nao/shared/types';

import { type GitIdentity, withRequester } from '../utils/git-identity';
import { GENERIC_GIT_PROVIDER } from './generic-git';
import * as github from './github';
import * as gitlab from './gitlab';

export type InternalRepoProvider = RepoProvider | 'generic';

export type OpenReviewRequestResult =
	| { kind: 'created'; url: string }
	| { kind: 'link'; url: string; apiRefused?: boolean };

export interface ReviewRequest {
	url: string;
	state: 'open' | 'closed' | 'merged';
	mergedAt: string | null;
	closedAt: string | null;
}

export interface ReviewRequestProvider {
	getToken: (userId: string) => Promise<string | null>;
	notConnectedMessage: string;
	isIntegrationAvailable: () => boolean;
	authenticatedRepoUrl: (token: string, repoFullName: string) => string;
	publicRepoUrl: (repoFullName: string) => string;
	cloneRepo: (token: string, repoFullName: string, dir: string, branch?: string) => void;
	getGitInfo: (dir: string) => { branch: string | null };
	getUserGitIdentity: (args: { token: string | null; user: GitIdentity }) => Promise<GitIdentity>;
	commitCoAuthors: (requester: GitIdentity) => GitIdentity[];
	/** GitHub or GitLab itself, whose git credentials go through askpass rather than the remote URL. */
	isFirstParty: boolean;
	commitAllAndPushBranch: (args: {
		token: string;
		repoFullName: string;
		dir: string;
		branch: string;
		message: string;
		author: GitIdentity;
		coAuthors?: GitIdentity[];
	}) => string;
	pushBranch: (args: { token: string; repoFullName: string; dir: string; branch: string }) => string;
	findOpenReviewRequest: (args: {
		token: string;
		repoFullName: string;
		branch: string;
		projectId: string;
		userId: string;
	}) => Promise<OpenReviewRequestResult | null>;
	findReviewRequestByBranch: (token: string, repoFullName: string, branch: string) => Promise<ReviewRequest | null>;
	/** Null when the provider has no API telling who committed to each branch, or there are too many to list. */
	listBranches: (token: string, repoFullName: string) => Promise<RepoBranch[] | null>;
	openReviewRequest: (
		token: string,
		repoFullName: string,
		args: {
			title: string;
			head: string;
			base: string;
			body: string;
			requester: GitIdentity;
			pushOutput: string;
		},
	) => Promise<OpenReviewRequestResult | null>;
}

export const REVIEW_REQUEST_PROVIDERS: Record<InternalRepoProvider, ReviewRequestProvider> = {
	github: {
		getToken: async (userId) => (await import('../queries/user.queries')).getGithubToken(userId),
		notConnectedMessage: 'GitHub is not connected. Connect your GitHub account first.',
		isIntegrationAvailable: () => github.isGithubIntegrationAvailable(),
		authenticatedRepoUrl: (token, repoFullName) => github.authenticatedRepoUrl(token, repoFullName),
		publicRepoUrl: (repoFullName) => github.publicRepoUrl(repoFullName),
		cloneRepo: github.cloneRepo,
		getGitInfo: github.getGitInfo,
		getUserGitIdentity: ({ token }) => github.getUserGitIdentity(requireToken(token)),
		commitCoAuthors: () => [github.NAO_CO_AUTHOR],
		isFirstParty: true,
		commitAllAndPushBranch: github.commitAllAndPushBranch,
		pushBranch: (args) => github.pushBranch(args),
		findOpenReviewRequest: ({ token, repoFullName, branch }) =>
			github.findOpenPullRequest(token, repoFullName, branch).then(toCreatedReviewRequest),
		findReviewRequestByBranch: (token, repoFullName, branch) =>
			github.findPullRequestByBranch(token, repoFullName, branch),
		listBranches: (token, repoFullName) => github.listBranches(token, repoFullName),
		openReviewRequest: async (token, repoFullName, { title, head, base, body }) => {
			const pullRequest = await github.createPullRequest(token, repoFullName, { title, head, base, body });
			return { kind: 'created', url: pullRequest.html_url };
		},
	},
	gitlab: {
		getToken: async (userId) => (await import('../queries/user.queries')).getGitlabToken(userId),
		notConnectedMessage: 'GitLab is not connected. Connect your GitLab account first.',
		isIntegrationAvailable: () => gitlab.isGitlabIntegrationAvailable(),
		authenticatedRepoUrl: (token, repoFullName) => gitlab.authenticatedRepoUrl(token, repoFullName),
		publicRepoUrl: (repoFullName) => gitlab.publicRepoUrl(repoFullName),
		cloneRepo: gitlab.cloneRepo,
		getGitInfo: gitlab.getGitInfo,
		getUserGitIdentity: ({ token }) => gitlab.getUserGitIdentity(requireToken(token)),
		commitCoAuthors: () => [gitlab.NAO_CO_AUTHOR],
		isFirstParty: true,
		commitAllAndPushBranch: gitlab.commitAllAndPushBranch,
		pushBranch: (args) => gitlab.pushBranch(args),
		findOpenReviewRequest: ({ token, repoFullName, branch }) =>
			gitlab.findOpenMergeRequest(token, repoFullName, branch).then(toCreatedReviewRequest),
		findReviewRequestByBranch: (token, repoFullName, branch) =>
			gitlab.findMergeRequestByBranch(token, repoFullName, branch),
		listBranches: (token, repoFullName) => gitlab.listBranches(token, repoFullName),
		openReviewRequest: async (token, repoFullName, { title, head, base, body }) => {
			const mergeRequest = await gitlab.createMergeRequest(token, repoFullName, {
				title,
				source_branch: head,
				target_branch: base,
				description: body,
			});
			return { kind: 'created', url: mergeRequest.web_url };
		},
	},
	generic: GENERIC_GIT_PROVIDER,
};

/**
 * Everyone works through one access token: its account authors the commits and opens the review requests, which credit
 * the person who asked for them. Branch authors all look like that account, so only nao knows whose a branch is.
 */
export function withSharedAccessToken(provider: ReviewRequestProvider, token: string): ReviewRequestProvider {
	return {
		...provider,
		getToken: async () => token,
		isIntegrationAvailable: () => true,
		commitCoAuthors: (requester) => [requester],
		listBranches: async (branchesToken, repoFullName) => {
			const branches = await provider.listBranches(branchesToken, repoFullName);
			return branches?.map((branch) => ({ ...branch, isMine: false })) ?? null;
		},
		openReviewRequest: (reviewToken, repoFullName, args) =>
			provider.openReviewRequest(reviewToken, repoFullName, {
				...args,
				body: withRequester(args.body, args.requester),
			}),
	};
}

export function getRepoProviderDisplayName(provider: string | null | undefined): string {
	if (provider === 'github') {
		return 'GitHub';
	}
	if (provider === 'gitlab') {
		return 'GitLab';
	}
	return provider === 'generic' ? 'Git' : 'Git provider';
}

function requireToken(token: string | null): string {
	if (token === null) {
		throw new Error('Git provider token is unavailable.');
	}
	return token;
}

function toCreatedReviewRequest(reviewRequest: { url: string } | null): OpenReviewRequestResult | null {
	return reviewRequest ? { kind: 'created', url: reviewRequest.url } : null;
}

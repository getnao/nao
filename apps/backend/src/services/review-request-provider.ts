import type { RepoProvider } from '@nao/shared/types';

import type { GitIdentity } from '../utils/git-identity';
import * as github from './github';
import * as gitlab from './gitlab';

export interface ReviewRequestProvider {
	getToken: (userId: string) => Promise<string | null>;
	notConnectedMessage: string;
	isIntegrationAvailable: () => boolean;
	authenticatedRepoUrl: (token: string, repoFullName: string) => string;
	publicRepoUrl: (repoFullName: string) => string;
	cloneRepo: (token: string, repoFullName: string, dir: string) => void;
	getGitInfo: (dir: string) => { branch: string | null };
	getUserGitIdentity: (token: string) => Promise<GitIdentity>;
	coAuthor: GitIdentity;
	commitAllAndPushBranch: (args: {
		token: string;
		repoFullName: string;
		dir: string;
		branch: string;
		message: string;
		author: GitIdentity;
		coAuthors?: GitIdentity[];
	}) => void;
	pushBranch: (args: { token: string; repoFullName: string; dir: string; branch: string }) => void;
	openReviewRequest: (
		token: string,
		repoFullName: string,
		args: { title: string; head: string; base: string; body: string },
	) => Promise<{ url: string }>;
}

export const REVIEW_REQUEST_PROVIDERS: Record<RepoProvider, ReviewRequestProvider> = {
	github: {
		getToken: async (userId) => (await import('../queries/user.queries')).getGithubToken(userId),
		notConnectedMessage: 'GitHub is not connected. Connect your GitHub account first.',
		isIntegrationAvailable: () => github.isGithubIntegrationAvailable(),
		authenticatedRepoUrl: (token, repoFullName) => github.authenticatedRepoUrl(token, repoFullName),
		publicRepoUrl: (repoFullName) => github.publicRepoUrl(repoFullName),
		cloneRepo: github.cloneRepo,
		getGitInfo: github.getGitInfo,
		getUserGitIdentity: github.getUserGitIdentity,
		coAuthor: github.NAO_CO_AUTHOR,
		commitAllAndPushBranch: github.commitAllAndPushBranch,
		pushBranch: (args) => github.pushBranch(args),
		openReviewRequest: async (token, repoFullName, { title, head, base, body }) => {
			const pullRequest = await github.createPullRequest(token, repoFullName, { title, head, base, body });
			return { url: pullRequest.html_url };
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
		getUserGitIdentity: gitlab.getUserGitIdentity,
		coAuthor: gitlab.NAO_CO_AUTHOR,
		commitAllAndPushBranch: gitlab.commitAllAndPushBranch,
		pushBranch: (args) => gitlab.pushBranch(args),
		openReviewRequest: async (token, repoFullName, { title, head, base, body }) => {
			const mergeRequest = await gitlab.createMergeRequest(token, repoFullName, {
				title,
				source_branch: head,
				target_branch: base,
				description: body,
			});
			return { url: mergeRequest.web_url };
		},
	},
};

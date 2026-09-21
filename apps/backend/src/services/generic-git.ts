import { execFileSync, spawnSync } from 'node:child_process';

import { env } from '../env';
import {
	detectGitPlatform,
	type GitPlatform,
	resolveContextSourceGitToken,
	sanitizeContextSourceRepositoryUrl,
} from '../utils/context-repo';
import { GitIdentity, NAO_CO_AUTHOR, withCoAuthors } from '../utils/git-identity';
import { toGitError } from '../utils/git-repo';
import * as github from './github';
import * as gitlab from './gitlab';
import type { OpenReviewRequestResult, ReviewRequestProvider } from './review-request-provider';

export interface ParsedGenericRepository {
	host: string;
	origin: string;
	repositoryPath: string;
}

export const GENERIC_GIT_PROVIDER: ReviewRequestProvider = {
	getToken: async () => resolveContextSourceGitToken(),
	notConnectedMessage: 'Add an access token or SSH deploy key to edit context files.',
	isIntegrationAvailable: () =>
		env.NAO_CONTEXT_SOURCE === 'git' && !!env.NAO_CONTEXT_GIT_URL && resolveContextSourceGitToken() !== null,
	authenticatedRepoUrl,
	publicRepoUrl: sanitizeContextSourceRepositoryUrl,
	cloneRepo,
	getGitInfo,
	getUserGitIdentity: async ({ user }) => user,
	coAuthor: NAO_CO_AUTHOR,
	commitAllAndPushBranch,
	pushBranch,
	findOpenReviewRequest,
	findReviewRequestByBranch: async () => null,
	openReviewRequest,
};

export function parseGenericRepositoryUrl(repositoryUrl: string): ParsedGenericRepository | null {
	const shorthand = repositoryUrl.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
	if (!repositoryUrl.includes('://') && shorthand) {
		return toParsedRepository(shorthand[1], shorthand[2], `https://${shorthand[1]}`);
	}
	try {
		const parsed = new URL(repositoryUrl);
		return toParsedRepository(parsed.hostname, parsed.pathname, `${parsed.protocol}//${parsed.host}`);
	} catch {
		return null;
	}
}

export function parseReviewRequestLink(pushOutput: string): string | null {
	for (const line of pushOutput.split(/\r?\n/)) {
		if (!/^\s*remote:\s*/i.test(line)) {
			continue;
		}
		const url = line.match(/https?:\/\/[^\s<>()]+/)?.[0]?.replace(/[.,;:]$/, '');
		if (url) {
			return url;
		}
	}
	return null;
}

function authenticatedRepoUrl(token: string, repositoryUrl: string): string {
	if (!token || !/^https?:\/\//i.test(repositoryUrl)) {
		return repositoryUrl;
	}
	const parsed = new URL(repositoryUrl);
	if (parsed.username || parsed.password) {
		return repositoryUrl;
	}
	if (parsed.hostname.toLowerCase() === 'bitbucket.org') {
		parsed.username = 'x-token-auth';
		parsed.password = token;
	} else {
		parsed.username = token;
	}
	return parsed.toString();
}

function cloneRepo(token: string, repositoryUrl: string, targetDir: string): void {
	execFileSync('git', ['clone', authenticatedRepoUrl(token, repositoryUrl), targetDir], {
		timeout: 120_000,
		stdio: 'pipe',
	});
	execFileSync('git', ['remote', 'set-url', 'origin', sanitizeContextSourceRepositoryUrl(repositoryUrl)], {
		cwd: targetDir,
		timeout: 5_000,
		stdio: 'pipe',
	});
}

function getGitInfo(dir: string): { branch: string | null } {
	try {
		const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
			cwd: dir,
			timeout: 5_000,
			stdio: 'pipe',
		})
			.toString()
			.trim();
		return { branch: branch && branch !== 'HEAD' ? branch : null };
	} catch {
		return { branch: null };
	}
}

function commitAllAndPushBranch(args: {
	token: string;
	repoFullName: string;
	dir: string;
	branch: string;
	message: string;
	author: GitIdentity;
	coAuthors?: GitIdentity[];
}): string {
	const options = { cwd: args.dir, stdio: 'pipe' as const, timeout: 120_000 };
	const identity = {
		GIT_AUTHOR_NAME: args.author.name,
		GIT_AUTHOR_EMAIL: args.author.email,
		GIT_COMMITTER_NAME: args.author.name,
		GIT_COMMITTER_EMAIL: args.author.email,
	};
	execFileSync('git', ['checkout', '-b', args.branch], options);
	execFileSync('git', ['add', '-A'], options);
	execFileSync('git', ['commit', '-m', withCoAuthors(args.message, args.coAuthors ?? [])], {
		...options,
		env: { ...process.env, ...identity },
	});
	return pushBranch(args);
}

function pushBranch(args: { token: string; repoFullName: string; dir: string; branch: string }): string {
	const result = spawnSync(
		'git',
		['push', authenticatedRepoUrl(args.token, args.repoFullName), `HEAD:refs/heads/${args.branch}`],
		{
			cwd: args.dir,
			encoding: 'utf8',
			timeout: 120_000,
		},
	);
	if (result.error || result.status !== 0) {
		const spawnError = result.error as NodeJS.ErrnoException | undefined;
		throw toGitError({
			message: spawnError?.message ?? 'Git push failed.',
			code: spawnError?.code,
			stderr: result.stderr,
			killed: result.signal !== null,
		});
	}
	return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

async function findOpenReviewRequest(args: {
	token: string;
	repoFullName: string;
	branch: string;
	projectId: string;
	userId: string;
}): Promise<OpenReviewRequestResult | null> {
	const queries = await import('../queries/context-branch-ownership.queries');
	const stored = await queries.getContextBranchReviewRequest(args.projectId, args.branch, args.userId);
	if (stored?.kind === 'created') {
		return stored;
	}

	const repository = parseGenericRepositoryUrl(args.repoFullName);
	const platform = env.NAO_CONTEXT_GIT_PLATFORM ?? detectGitPlatform(args.repoFullName);
	if (!platform || !repository || !hasPlatformApiAuthentication(platform, args.token, args.repoFullName)) {
		return stored;
	}

	let reviewRequest: { url: string } | null;
	try {
		reviewRequest = await findPlatformReviewRequest(
			platform,
			args.token,
			args.repoFullName,
			repository,
			args.branch,
		);
	} catch {
		return stored;
	}
	if (!reviewRequest) {
		return stored;
	}

	const result: OpenReviewRequestResult = { kind: 'created', url: reviewRequest.url };
	try {
		await queries.setContextBranchReviewRequest(args.projectId, args.branch, args.userId, result);
	} catch {
		return result;
	}
	return result;
}

async function openReviewRequest(
	token: string,
	repositoryUrl: string,
	args: {
		title: string;
		head: string;
		base: string;
		body: string;
		requester: GitIdentity;
		pushOutput: string;
	},
): Promise<OpenReviewRequestResult | null> {
	const parsed = parseGenericRepositoryUrl(repositoryUrl);
	const platform = env.NAO_CONTEXT_GIT_PLATFORM ?? detectGitPlatform(repositoryUrl);
	if (platform && parsed && hasPlatformApiAuthentication(platform, token, repositoryUrl)) {
		try {
			return await createReviewRequest(platform, token, repositoryUrl, parsed, args);
		} catch (error) {
			const { logger, serializeError } = await import('../utils/logger');
			logger.warn('Git platform API could not create a review request after the branch was pushed.', {
				source: 'system',
				context: {
					error: serializeError(error),
					repositoryUrl: sanitizeContextSourceRepositoryUrl(repositoryUrl),
				},
			});
			const url = parseReviewRequestLink(args.pushOutput);
			return url ? { kind: 'link', url, apiRefused: true } : null;
		}
	}
	const url = parseReviewRequestLink(args.pushOutput);
	return url ? { kind: 'link', url } : null;
}

async function findPlatformReviewRequest(
	platform: GitPlatform,
	token: string,
	repositoryUrl: string,
	repository: ParsedGenericRepository,
	branch: string,
): Promise<{ url: string } | null> {
	if (platform === 'github') {
		const apiBaseUrl = repository.host === 'github.com' ? 'https://api.github.com' : `${repository.origin}/api/v3`;
		return github.findOpenPullRequest(token, repository.repositoryPath, branch, apiBaseUrl);
	}
	if (platform === 'gitlab') {
		return gitlab.findOpenMergeRequest(token, repository.repositoryPath, branch, `${repository.origin}/api/v4`);
	}
	const authorization = resolveBitbucketAuthorization(token, repositoryUrl);
	return authorization ? findOpenBitbucketPullRequest(authorization, repository.repositoryPath, branch) : null;
}

async function createReviewRequest(
	platform: GitPlatform,
	token: string,
	repositoryUrl: string,
	repository: ParsedGenericRepository,
	args: { title: string; head: string; base: string; body: string; requester: GitIdentity },
): Promise<OpenReviewRequestResult> {
	const body = `${args.body}${args.body ? '\n\n' : ''}Requested by ${args.requester.name}`;
	if (platform === 'github') {
		const apiBaseUrl = repository.host === 'github.com' ? 'https://api.github.com' : `${repository.origin}/api/v3`;
		const pullRequest = await github.createPullRequest(
			token,
			repository.repositoryPath,
			{ title: args.title, head: args.head, base: args.base, body },
			apiBaseUrl,
		);
		return { kind: 'created', url: pullRequest.html_url };
	}
	if (platform === 'gitlab') {
		const mergeRequest = await gitlab.createMergeRequest(
			token,
			repository.repositoryPath,
			{
				title: args.title,
				source_branch: args.head,
				target_branch: args.base,
				description: body,
			},
			`${repository.origin}/api/v4`,
		);
		return { kind: 'created', url: mergeRequest.web_url };
	}
	const authorization = resolveBitbucketAuthorization(token, repositoryUrl);
	if (!authorization) {
		throw new Error('Bitbucket API authentication is unavailable.');
	}
	return createBitbucketPullRequest(authorization, repository.repositoryPath, {
		title: args.title,
		description: body,
		head: args.head,
		base: args.base,
	});
}

async function createBitbucketPullRequest(
	authorization: string,
	repositoryPath: string,
	args: { title: string; description: string; head: string; base: string },
): Promise<OpenReviewRequestResult> {
	const response = await fetch(`https://api.bitbucket.org/2.0/repositories/${repositoryPath}/pullrequests`, {
		method: 'POST',
		headers: {
			Authorization: authorization,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			title: args.title,
			description: args.description,
			source: { branch: { name: args.head } },
			destination: { branch: { name: args.base } },
		}),
	});
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`Bitbucket API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
	}
	const result = (await response.json()) as { links: { html: { href: string } } };
	return { kind: 'created', url: result.links.html.href };
}

async function findOpenBitbucketPullRequest(
	authorization: string,
	repositoryPath: string,
	branch: string,
): Promise<{ url: string } | null> {
	const params = new URLSearchParams({
		q: `source.branch.name="${branch}"`,
		state: 'OPEN',
	});
	const response = await fetch(
		`https://api.bitbucket.org/2.0/repositories/${repositoryPath}/pullrequests?${params}`,
		{ headers: { Authorization: authorization } },
	);
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`Bitbucket API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
	}
	const result = (await response.json()) as { values?: Array<{ links?: { html?: { href?: string } } }> };
	const url = result.values?.[0]?.links?.html?.href;
	return url ? { url } : null;
}

function hasPlatformApiAuthentication(platform: GitPlatform, token: string, repositoryUrl: string): boolean {
	return platform === 'bitbucket' ? resolveBitbucketAuthorization(token, repositoryUrl) !== null : !!token;
}

function resolveBitbucketAuthorization(token: string, repositoryUrl: string): string | null {
	if (token) {
		return `Bearer ${token}`;
	}
	try {
		const parsed = new URL(repositoryUrl);
		if (!parsed.username || !parsed.password) {
			return null;
		}
		const username = decodeURIComponent(parsed.username);
		const password = decodeURIComponent(parsed.password);
		return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
	} catch {
		return null;
	}
}

function toParsedRepository(host: string, repositoryPath: string, origin: string): ParsedGenericRepository | null {
	const normalizedPath = repositoryPath
		.replace(/^\/+/, '')
		.replace(/\/+$/, '')
		.replace(/\.git$/i, '');
	return host && normalizedPath ? { host: host.toLowerCase(), origin, repositoryPath: normalizedPath } : null;
}

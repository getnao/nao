import { execFileSync, execSync } from 'node:child_process';

import { env } from '../env';

export interface GitLabProject {
	id: number;
	name: string;
	path_with_namespace: string;
	description: string | null;
	visibility: 'public' | 'internal' | 'private';
	web_url: string;
	default_branch: string | null;
	last_activity_at: string;
	namespace: {
		name: string;
		path: string;
		avatar_url: string | null;
	};
}

export interface GitLabUser {
	id: number;
	username: string;
	name: string;
	email: string | null;
	avatar_url: string;
}

interface GitlabOAuthConfig {
	clientId: string;
	clientSecret: string;
}

export interface GitInfo {
	isGitRepo: boolean;
	isGitlab: boolean;
	repoFullName: string | null;
	branch: string | null;
	lastCommitMessage: string | null;
	lastCommitDate: string | null;
}

export interface GitIdentity {
	name: string;
	email: string;
}

export const NAO_CO_AUTHOR: GitIdentity = {
	name: 'nao',
	email: 'naoagent@getnao.io',
};

export function gitlabBaseUrl(): string {
	return env.GITLAB_BASE_URL?.replace(/\/$/, '') || 'https://gitlab.com';
}

function gitlabApiUrl(): string {
	return `${gitlabBaseUrl()}/api/v4`;
}

function callbackUrl(): string | undefined {
	if (env.GITLAB_REDIRECT_URI) {
		return env.GITLAB_REDIRECT_URI;
	}
	return undefined;
}

function authenticatedRepoUrl(token: string, repoFullName: string): string {
	const base = gitlabBaseUrl();
	const withoutScheme = base.replace(/^https?:\/\//, '');
	return `https://oauth2:${token}@${withoutScheme}/${repoFullName}.git`;
}

function publicRepoUrl(repoFullName: string): string {
	return `${gitlabBaseUrl()}/${repoFullName}.git`;
}

export function gitlabOAuthConfig(): GitlabOAuthConfig | null {
	const { GITLAB_CLIENT_ID, GITLAB_CLIENT_SECRET } = env;
	if (!GITLAB_CLIENT_ID || !GITLAB_CLIENT_SECRET) {
		return null;
	}
	return { clientId: GITLAB_CLIENT_ID, clientSecret: GITLAB_CLIENT_SECRET };
}

export function isGitlabIntegrationAvailable(): boolean {
	return gitlabOAuthConfig() !== null;
}

export function isGitlabSsoEnabled(): boolean {
	return env.GITLAB_SSO && gitlabOAuthConfig() !== null;
}

export function buildAuthorizationUrl(state: string): string {
	const config = gitlabOAuthConfig();
	if (!config) {
		throw new Error('GitLab integration is not configured');
	}
	const params = new URLSearchParams({
		client_id: config.clientId,
		response_type: 'code',
		scope: 'api read_user openid email',
		state,
	});
	const redirectUri = callbackUrl();
	if (redirectUri) {
		params.set('redirect_uri', redirectUri);
	}
	return `${gitlabBaseUrl()}/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
	const config = gitlabOAuthConfig();
	if (!config) {
		throw new Error('GitLab integration is not configured');
	}
	const body: Record<string, string> = {
		client_id: config.clientId,
		client_secret: config.clientSecret,
		code,
		grant_type: 'authorization_code',
	};
	const redirectUri = callbackUrl();
	if (redirectUri) {
		body.redirect_uri = redirectUri;
	}
	const res = await fetch(`${gitlabBaseUrl()}/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
	if (data.error || !data.access_token) {
		throw new Error(data.error_description || data.error || 'Failed to exchange code for token');
	}
	return data.access_token;
}

export async function getUser(token: string): Promise<GitLabUser> {
	const res = await fetch(`${gitlabApiUrl()}/user`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) {
		throw new Error(`GitLab API error: ${res.status}`);
	}
	return res.json() as Promise<GitLabUser>;
}

export async function listProjects(
	token: string,
	opts?: { page?: number; perPage?: number; search?: string },
): Promise<{ projects: GitLabProject[]; hasMore: boolean }> {
	const page = opts?.page ?? 1;
	const perPage = opts?.perPage ?? 30;

	const params = new URLSearchParams({
		membership: 'true',
		order_by: 'last_activity_at',
		simple: 'true',
		per_page: String(perPage),
		page: String(page),
	});
	if (opts?.search) {
		params.set('search', opts.search);
	}

	const res = await fetch(`${gitlabApiUrl()}/projects?${params}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) {
		throw new Error(`GitLab API error: ${res.status}`);
	}

	const projects = (await res.json()) as GitLabProject[];
	const nextPage = res.headers.get('x-next-page');
	const hasMore = !!nextPage && nextPage !== '';

	return { projects, hasMore };
}

export function cloneRepo(token: string, fullName: string, targetDir: string): void {
	const cloneUrl = authenticatedRepoUrl(token, fullName);
	const cleanUrl = publicRepoUrl(fullName);
	execFileSync('git', ['clone', '--depth', '1', cloneUrl, targetDir], {
		timeout: 120_000,
		stdio: 'pipe',
	});
	execFileSync('git', ['remote', 'set-url', 'origin', cleanUrl], {
		cwd: targetDir,
		timeout: 5_000,
		stdio: 'pipe',
	});
}

export function removeOriginRemote(projectDir: string): void {
	execFileSync('git', ['remote', 'remove', 'origin'], {
		cwd: projectDir,
		stdio: 'pipe',
		timeout: 5_000,
	});
}

export function getGitInfo(projectDir: string): GitInfo {
	const empty: GitInfo = {
		isGitRepo: false,
		isGitlab: false,
		repoFullName: null,
		branch: null,
		lastCommitMessage: null,
		lastCommitDate: null,
	};

	try {
		const opts = { cwd: projectDir, stdio: 'pipe' as const, timeout: 5_000 };

		const remoteUrl = execSync('git remote get-url origin', opts).toString().trim();
		const base = gitlabBaseUrl().replace(/^https?:\/\//, '');
		const gitlabMatch = remoteUrl.match(new RegExp(`${escapeRegExp(base)}[/:](.+?)(?:\\.git)?$`, 'i'));

		const branch = execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
		const lastCommitMessage = execSync('git log -1 --format=%s', opts).toString().trim();
		const lastCommitDate = execSync('git log -1 --format=%cI', opts).toString().trim();

		return {
			isGitRepo: true,
			isGitlab: !!gitlabMatch,
			repoFullName: gitlabMatch?.[1] ?? null,
			branch,
			lastCommitMessage,
			lastCommitDate,
		};
	} catch {
		return empty;
	}
}

export function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function getUserGitIdentity(token: string): Promise<GitIdentity> {
	const user = await getUser(token);
	const email = user.email ?? `${user.username}@users.noreply.${new URL(gitlabBaseUrl()).hostname}`;
	return { name: user.name || user.username, email };
}

export function commitAllAndPushBranch(args: {
	token: string;
	repoFullName: string;
	dir: string;
	branch: string;
	message: string;
	author: GitIdentity;
	coAuthors?: GitIdentity[];
}): void {
	const { token, repoFullName, dir, branch, message, author, coAuthors = [] } = args;
	const opts = { cwd: dir, stdio: 'pipe' as const, timeout: 120_000 };

	const identity = {
		GIT_AUTHOR_NAME: author.name,
		GIT_AUTHOR_EMAIL: author.email,
		GIT_COMMITTER_NAME: author.name,
		GIT_COMMITTER_EMAIL: author.email,
	};

	execFileSync('git', ['checkout', '-b', branch], opts);
	execFileSync('git', ['add', '-A'], opts);
	execFileSync('git', ['commit', '-m', withCoAuthors(message, coAuthors)], {
		...opts,
		env: { ...process.env, ...identity },
	});

	execFileSync('git', ['push', authenticatedRepoUrl(token, repoFullName), `HEAD:refs/heads/${branch}`], opts);
}

function withCoAuthors(message: string, coAuthors: GitIdentity[]): string {
	if (coAuthors.length === 0) {
		return message;
	}
	const trailers = coAuthors.map((c) => `Co-authored-by: ${c.name} <${c.email}>`).join('\n');
	return `${message.trimEnd()}\n\n${trailers}`;
}

export interface CreateMergeRequestInput {
	title: string;
	source_branch: string;
	target_branch: string;
	description?: string;
}

export async function createMergeRequest(
	token: string,
	repoFullName: string,
	input: CreateMergeRequestInput,
): Promise<{ iid: number; web_url: string }> {
	const encodedPath = encodeURIComponent(repoFullName);
	const res = await fetch(`${gitlabApiUrl()}/projects/${encodedPath}/merge_requests`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(input),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`GitLab API error ${res.status}: ${body}`);
	}
	const data = (await res.json()) as { iid: number; web_url: string };
	return { iid: data.iid, web_url: data.web_url };
}

export interface GitLabMergeRequest {
	iid: number;
	state: 'opened' | 'closed' | 'merged' | 'locked';
	web_url: string;
	merged_at: string | null;
}

export async function getMergeRequest(token: string, repoFullName: string, iid: number): Promise<GitLabMergeRequest> {
	const encodedPath = encodeURIComponent(repoFullName);
	const res = await fetch(`${gitlabApiUrl()}/projects/${encodedPath}/merge_requests/${iid}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) {
		throw new Error(`GitLab API error: ${res.status}`);
	}
	return res.json() as Promise<GitLabMergeRequest>;
}

export function parseMergeRequestUrl(url: string): { repo: string; iid: number } | null {
	let parsedUrl: URL;
	let parsedBase: URL;
	try {
		parsedUrl = new URL(url);
		parsedBase = new URL(gitlabBaseUrl());
	} catch {
		return null;
	}
	if (parsedUrl.protocol !== parsedBase.protocol || parsedUrl.host !== parsedBase.host) {
		return null;
	}

	const basePath = parsedBase.pathname.replace(/\/+$/, '');
	if (!parsedUrl.pathname.startsWith(basePath)) {
		return null;
	}
	const relativePath = parsedUrl.pathname.slice(basePath.length);
	const match = relativePath.match(/^\/(.+)\/-\/merge_requests\/(\d+)$/);

	if (!match) {
		return null;
	}
	return { repo: match[1], iid: Number(match[2]) };
}

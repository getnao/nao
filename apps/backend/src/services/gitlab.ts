import { execFileSync } from 'node:child_process';

import { env } from '../env';
import { GitIdentity, NAO_CO_AUTHOR, withCoAuthors } from '../utils/git-identity';
import { configDir, getRepoSubPath, isContextConfigFile, shallowestSubPath } from './git-repo';

export { NAO_CO_AUTHOR };
export { getRepoSubPath };

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

interface GitLabMergeRequestSummary {
	web_url: string;
	state: GitLabMergeRequest['state'];
	merged_at: string | null;
	closed_at: string | null;
	source_project_id: number;
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

export function authenticatedRepoUrl(token: string, repoFullName: string): string {
	const base = gitlabBaseUrl();
	const withoutScheme = base.replace(/^https?:\/\//, '');
	return `https://oauth2:${token}@${withoutScheme}/${repoFullName}.git`;
}

export function publicRepoUrl(repoFullName: string): string {
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

export function cloneRepo(token: string, fullName: string, targetDir: string, branch?: string): void {
	const cloneUrl = authenticatedRepoUrl(token, fullName);
	const cleanUrl = publicRepoUrl(fullName);
	execFileSync('git', ['clone', '--depth', '1', ...(branch ? ['--branch', branch] : []), cloneUrl, targetDir], {
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

		const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], opts).toString().trim();
		const base = gitlabBaseUrl().replace(/^https?:\/\//, '');
		const gitlabMatch = remoteUrl.match(new RegExp(`${escapeRegExp(base)}[/:](.+?)(?:\\.git)?$`, 'i'));
		const branch = readCurrentBranch(projectDir);
		const lastCommitMessage = readOptionalGitValue(projectDir, ['log', '-1', '--format=%s']);
		const lastCommitDate = readOptionalGitValue(projectDir, ['log', '-1', '--format=%cI']);

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

function readCurrentBranch(projectDir: string): string | null {
	const branch = readOptionalGitValue(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
	return branch && branch !== 'HEAD' ? branch : null;
}

function readOptionalGitValue(projectDir: string, args: string[]): string | null {
	try {
		return execFileSync('git', args, {
			cwd: projectDir,
			stdio: 'pipe',
			timeout: 5_000,
		})
			.toString()
			.trim();
	} catch {
		return null;
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
}): string {
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

	return pushBranch({ token, repoFullName, dir, branch });
}

export function pushBranch(args: { token: string; repoFullName: string; dir: string; branch: string }): string {
	return execFileSync(
		'git',
		['push', authenticatedRepoUrl(args.token, args.repoFullName), `HEAD:refs/heads/${args.branch}`],
		{
			cwd: args.dir,
			stdio: 'pipe',
			timeout: 120_000,
		},
	).toString();
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
	apiBaseUrl = gitlabApiUrl(),
): Promise<{ iid: number; web_url: string }> {
	const encodedPath = encodeURIComponent(repoFullName);
	const res = await fetch(`${apiBaseUrl}/projects/${encodedPath}/merge_requests`, {
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

export async function findOpenMergeRequest(
	token: string,
	repoFullName: string,
	branch: string,
	apiBaseUrl = gitlabApiUrl(),
): Promise<{ url: string } | null> {
	const projectId = await getGitLabProjectId(token, repoFullName, apiBaseUrl);
	const mergeRequest = await findMergeRequestForBranch(token, repoFullName, branch, projectId, 'opened', apiBaseUrl);
	return mergeRequest ? { url: mergeRequest.web_url } : null;
}

export async function findMergeRequestByBranch(
	token: string,
	repoFullName: string,
	branch: string,
): Promise<{
	url: string;
	state: 'open' | 'closed' | 'merged';
	mergedAt: string | null;
	closedAt: string | null;
} | null> {
	const projectId = await getGitLabProjectId(token, repoFullName);
	const openMergeRequest = await findMergeRequestForBranch(token, repoFullName, branch, projectId, 'opened');
	const mergeRequest =
		openMergeRequest ?? (await findMergeRequestForBranch(token, repoFullName, branch, projectId, 'all'));
	if (!mergeRequest) {
		return null;
	}
	return {
		url: mergeRequest.web_url,
		state: mergeRequest.state === 'opened' ? 'open' : mergeRequest.state === 'merged' ? 'merged' : 'closed',
		mergedAt: mergeRequest.merged_at,
		closedAt: mergeRequest.closed_at,
	};
}

async function getGitLabProjectId(token: string, repoFullName: string, apiBaseUrl = gitlabApiUrl()): Promise<number> {
	const encodedPath = encodeURIComponent(repoFullName);
	const res = await fetch(`${apiBaseUrl}/projects/${encodedPath}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`GitLab API error ${res.status}: ${body}`);
	}
	const project = (await res.json()) as Pick<GitLabProject, 'id'>;
	return project.id;
}

async function findMergeRequestForBranch(
	token: string,
	repoFullName: string,
	branch: string,
	projectId: number,
	state: 'opened' | 'all',
	apiBaseUrl = gitlabApiUrl(),
): Promise<GitLabMergeRequestSummary | null> {
	const encodedPath = encodeURIComponent(repoFullName);
	let page = '1';
	while (page) {
		const params = new URLSearchParams({
			state,
			source_branch: branch,
			scope: 'all',
			order_by: 'updated_at',
			sort: 'desc',
			per_page: '100',
			page,
		});
		const res = await fetch(`${apiBaseUrl}/projects/${encodedPath}/merge_requests?${params}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) {
			const body = await res.text();
			throw new Error(`GitLab API error ${res.status}: ${body}`);
		}
		const mergeRequests = (await res.json()) as GitLabMergeRequestSummary[];
		const match = mergeRequests.find((candidate) => candidate.source_project_id === projectId);
		if (match) {
			return match;
		}
		page = res.headers.get('x-next-page') ?? '';
	}
	return null;
}

export interface GitLabMergeRequest {
	iid: number;
	state: 'opened' | 'closed' | 'merged' | 'locked';
	web_url: string;
	merged_at: string | null;
	closed_at: string | null;
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

const TREE_PAGE_SIZE = 100;
/** Safety ceiling to avoid an unbounded loop; large enough not to cap real repositories. */
const TREE_MAX_PAGES = 10_000;

export async function findContextConfigSubPath(token: string, repoFullName: string): Promise<string> {
	try {
		const encoded = encodeURIComponent(repoFullName);
		const dirs: string[] = [];
		for (let page = 1; page <= TREE_MAX_PAGES; page++) {
			const res = await fetch(
				`${gitlabApiUrl()}/projects/${encoded}/repository/tree?recursive=true&per_page=${TREE_PAGE_SIZE}&page=${page}`,
				{ headers: { Authorization: `Bearer ${token}` } },
			);
			if (!res.ok) {
				return '';
			}
			const entries = (await res.json()) as Array<{ type: string; path: string }>;
			for (const entry of entries) {
				if (entry.type === 'blob' && isContextConfigFile(entry.path)) {
					const dir = configDir(entry.path);
					if (dir === '') {
						return '';
					}
					dirs.push(dir);
				}
			}
			if (!res.headers.get('x-next-page')) {
				return shallowestSubPath(dirs);
			}
		}
		return '';
	} catch {
		return '';
	}
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

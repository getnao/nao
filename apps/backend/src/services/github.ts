import { execFileSync, execSync } from 'node:child_process';

import { env } from '../env';

const GITHUB_API = 'https://api.github.com';
const GITHUB_OAUTH_URL = 'https://github.com/login/oauth';

export interface GitHubRepo {
	id: number;
	name: string;
	full_name: string;
	description: string | null;
	private: boolean;
	html_url: string;
	default_branch: string;
	updated_at: string;
	owner: {
		login: string;
		avatar_url: string;
	};
}

export interface GitHubUser {
	login: string;
	avatar_url: string;
	name: string | null;
}

interface GithubOAuthConfig {
	clientId: string;
	clientSecret: string;
}

export function githubOAuthConfig(): GithubOAuthConfig | null {
	const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = env;
	if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
		return null;
	}
	return { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET };
}

export function isGithubIntegrationAvailable(): boolean {
	return githubOAuthConfig() !== null;
}

export function isGithubSsoEnabled(): boolean {
	return env.GITHUB_SSO && githubOAuthConfig() !== null;
}

export function buildAuthorizationUrl(state: string): string {
	const config = githubOAuthConfig();
	if (!config) {
		throw new Error('GitHub integration is not configured');
	}
	const params = new URLSearchParams({
		client_id: config.clientId,
		scope: 'repo',
		state,
	});
	return `${GITHUB_OAUTH_URL}/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
	const config = githubOAuthConfig();
	if (!config) {
		throw new Error('GitHub integration is not configured');
	}
	const res = await fetch(`${GITHUB_OAUTH_URL}/access_token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code,
		}),
	});

	const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
	if (data.error || !data.access_token) {
		throw new Error(data.error_description || data.error || 'Failed to exchange code for token');
	}
	return data.access_token;
}

export async function getUser(token: string): Promise<GitHubUser> {
	const res = await fetch(`${GITHUB_API}/user`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
	});
	if (!res.ok) {
		throw new Error(`GitHub API error: ${res.status}`);
	}
	return res.json() as Promise<GitHubUser>;
}

export async function listRepos(
	token: string,
	opts?: { page?: number; perPage?: number; search?: string },
): Promise<{ repos: GitHubRepo[]; hasMore: boolean }> {
	const page = opts?.page ?? 1;
	const perPage = opts?.perPage ?? 30;

	if (opts?.search) {
		return searchRepos(token, opts.search, page, perPage);
	}

	const params = new URLSearchParams({
		sort: 'updated',
		direction: 'desc',
		per_page: String(perPage),
		page: String(page),
	});

	const res = await fetch(`${GITHUB_API}/user/repos?${params}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
	});
	if (!res.ok) {
		throw new Error(`GitHub API error: ${res.status}`);
	}

	const repos = (await res.json()) as GitHubRepo[];
	const linkHeader = res.headers.get('link');
	const hasMore = !!linkHeader?.includes('rel="next"');

	return { repos, hasMore };
}

async function searchRepos(
	token: string,
	query: string,
	page: number,
	perPage: number,
): Promise<{ repos: GitHubRepo[]; hasMore: boolean }> {
	const lowerQuery = query.toLowerCase();
	const matched: GitHubRepo[] = [];
	const needed = page * perPage + 1;
	let fetchPage = 1;
	const maxPages = 5;

	while (fetchPage <= maxPages) {
		const params = new URLSearchParams({
			sort: 'updated',
			direction: 'desc',
			per_page: '100',
			page: String(fetchPage),
		});

		const res = await fetch(`${GITHUB_API}/user/repos?${params}`, {
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
		});
		if (!res.ok) {
			throw new Error(`GitHub API error: ${res.status}`);
		}

		const repos = (await res.json()) as GitHubRepo[];
		for (const r of repos) {
			if (r.full_name.toLowerCase().includes(lowerQuery) || r.description?.toLowerCase().includes(lowerQuery)) {
				matched.push(r);
			}
		}

		if (matched.length >= needed || !res.headers.get('link')?.includes('rel="next"')) {
			break;
		}
		fetchPage++;
	}

	const start = (page - 1) * perPage;
	return {
		repos: matched.slice(start, start + perPage),
		hasMore: matched.length > start + perPage,
	};
}

export function cloneRepo(token: string, fullName: string, targetDir: string): void {
	const cloneUrl = `https://x-access-token:${token}@github.com/${fullName}.git`;
	const cleanUrl = `https://github.com/${fullName}.git`;
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

export interface GitInfo {
	isGitRepo: boolean;
	isGithub: boolean;
	repoFullName: string | null;
	branch: string | null;
	lastCommitMessage: string | null;
	lastCommitDate: string | null;
}

export function getGitInfo(projectDir: string): GitInfo {
	const empty: GitInfo = {
		isGitRepo: false,
		isGithub: false,
		repoFullName: null,
		branch: null,
		lastCommitMessage: null,
		lastCommitDate: null,
	};

	try {
		const opts = { cwd: projectDir, stdio: 'pipe' as const, timeout: 5_000 };

		const remoteUrl = execSync('git remote get-url origin', opts).toString().trim();
		const githubMatch = remoteUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/);

		const branch = execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
		const lastCommitMessage = execSync('git log -1 --format=%s', opts).toString().trim();
		const lastCommitDate = execSync('git log -1 --format=%cI', opts).toString().trim();

		return {
			isGitRepo: true,
			isGithub: !!githubMatch,
			repoFullName: githubMatch?.[1] ?? null,
			branch,
			lastCommitMessage,
			lastCommitDate,
		};
	} catch {
		return empty;
	}
}

export function pullRepo(token: string, repoFullName: string, projectDir: string): string {
	const opts = { cwd: projectDir, stdio: 'pipe' as const, timeout: 120_000 };

	const authenticatedUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
	execFileSync('git', ['remote', 'set-url', 'origin', authenticatedUrl], opts);

	try {
		execFileSync('git', ['fetch', '--depth', '1', 'origin'], opts);
		const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts).toString().trim();
		const output = execFileSync('git', ['reset', '--hard', `origin/${branch}`], opts)
			.toString()
			.trim();
		return output;
	} finally {
		const cleanUrl = `https://github.com/${repoFullName}.git`;
		execFileSync('git', ['remote', 'set-url', 'origin', cleanUrl], { ...opts, timeout: 5_000 });
	}
}

const GITHUB_API_TIMEOUT_MS = 20_000;

export interface GithubIssueSummary {
	number: number;
	title: string;
	state: 'open' | 'closed';
	html_url: string;
	user: string | null;
	labels: string[];
	comments: number;
	created_at: string;
	updated_at: string;
	is_pull_request: boolean;
}

export interface GithubIssueDetail extends GithubIssueSummary {
	body: string | null;
	assignees: string[];
	milestone: string | null;
	comments_body?: GithubComment[];
}

export interface GithubPullRequestSummary {
	number: number;
	title: string;
	state: 'open' | 'closed' | 'merged';
	html_url: string;
	user: string | null;
	labels: string[];
	draft: boolean;
	base: string;
	head: string;
	created_at: string;
	updated_at: string;
	merged_at: string | null;
}

export interface GithubPullRequestDetail extends GithubPullRequestSummary {
	body: string | null;
	additions: number;
	deletions: number;
	changed_files: number;
	mergeable: boolean | null;
	comments_body?: GithubComment[];
	diff?: string;
}

export interface GithubComment {
	id: number;
	user: string | null;
	created_at: string;
	body: string;
	html_url: string;
}

export interface GithubSearchHit {
	repository: string;
	number: number;
	title: string;
	state: 'open' | 'closed';
	html_url: string;
	is_pull_request: boolean;
	updated_at: string;
}

export interface GithubFileContent {
	path: string;
	ref: string | null;
	size: number;
	encoding: 'utf-8' | 'base64' | 'binary';
	content: string;
	html_url: string;
}

export interface ListIssuesOptions {
	state?: 'open' | 'closed' | 'all';
	labels?: string;
	perPage?: number;
	page?: number;
}

export interface ListPullRequestsOptions {
	state?: 'open' | 'closed' | 'all';
	perPage?: number;
	page?: number;
}

export interface SearchOptions {
	perPage?: number;
	page?: number;
}

export interface CreateIssueInput {
	title: string;
	body?: string;
	labels?: string[];
	assignees?: string[];
}

export interface CreatePullRequestInput {
	title: string;
	head: string;
	base: string;
	body?: string;
	draft?: boolean;
}

export async function listIssues(
	token: string,
	repo: string,
	options: ListIssuesOptions = {},
): Promise<GithubIssueSummary[]> {
	const params = new URLSearchParams({
		state: options.state ?? 'open',
		per_page: String(clampPerPage(options.perPage)),
		page: String(options.page ?? 1),
	});
	if (options.labels) {
		params.set('labels', options.labels);
	}

	const data = await githubFetchJson<RawIssue[]>(token, `/repos/${repo}/issues?${params}`);
	return data.filter((issue) => !issue.pull_request).map(toIssueSummary);
}

export async function getIssue(
	token: string,
	repo: string,
	number: number,
	options: { includeComments?: boolean } = {},
): Promise<GithubIssueDetail> {
	const issue = await githubFetchJson<RawIssue>(token, `/repos/${repo}/issues/${number}`);
	const detail: GithubIssueDetail = {
		...toIssueSummary(issue),
		body: issue.body ?? null,
		assignees: (issue.assignees ?? []).map((a) => a.login),
		milestone: issue.milestone?.title ?? null,
	};

	if (options.includeComments) {
		detail.comments_body = await listIssueComments(token, repo, number);
	}
	return detail;
}

export async function listIssueComments(token: string, repo: string, number: number): Promise<GithubComment[]> {
	const data = await githubFetchJson<RawComment[]>(token, `/repos/${repo}/issues/${number}/comments?per_page=100`);
	return data.map(toComment);
}

export async function listPullRequests(
	token: string,
	repo: string,
	options: ListPullRequestsOptions = {},
): Promise<GithubPullRequestSummary[]> {
	const params = new URLSearchParams({
		state: options.state ?? 'open',
		per_page: String(clampPerPage(options.perPage)),
		page: String(options.page ?? 1),
		sort: 'updated',
		direction: 'desc',
	});

	const data = await githubFetchJson<RawPullRequest[]>(token, `/repos/${repo}/pulls?${params}`);
	return data.map(toPullRequestSummary);
}

export async function getPullRequest(
	token: string,
	repo: string,
	number: number,
	options: { includeComments?: boolean; includeDiff?: boolean } = {},
): Promise<GithubPullRequestDetail> {
	const pr = await githubFetchJson<RawPullRequest>(token, `/repos/${repo}/pulls/${number}`);
	const detail: GithubPullRequestDetail = {
		...toPullRequestSummary(pr),
		body: pr.body ?? null,
		additions: pr.additions ?? 0,
		deletions: pr.deletions ?? 0,
		changed_files: pr.changed_files ?? 0,
		mergeable: pr.mergeable ?? null,
	};

	if (options.includeComments) {
		detail.comments_body = await listIssueComments(token, repo, number);
	}
	if (options.includeDiff) {
		detail.diff = await getPullRequestDiff(token, repo, number);
	}
	return detail;
}

export async function getPullRequestDiff(token: string, repo: string, number: number): Promise<string> {
	const res = await githubFetch(token, `/repos/${repo}/pulls/${number}`, {
		headers: { Accept: 'application/vnd.github.v3.diff' },
	});
	const text = await res.text();
	return truncate(text, 60_000);
}

export async function searchIssues(
	token: string,
	query: string,
	options: SearchOptions = {},
): Promise<GithubSearchHit[]> {
	const params = new URLSearchParams({
		q: query,
		per_page: String(clampPerPage(options.perPage)),
		page: String(options.page ?? 1),
	});

	const data = await githubFetchJson<RawSearchResponse>(token, `/search/issues?${params}`);
	return data.items.map((item) => ({
		repository: extractRepoFromIssueUrl(item.repository_url),
		number: item.number,
		title: item.title,
		state: item.state,
		html_url: item.html_url,
		is_pull_request: !!item.pull_request,
		updated_at: item.updated_at,
	}));
}

export async function getFileContent(
	token: string,
	repo: string,
	path: string,
	ref?: string,
): Promise<GithubFileContent> {
	const params = ref ? `?ref=${encodeURIComponent(ref)}` : '';
	const data = await githubFetchJson<RawFileContent>(token, `/repos/${repo}/contents/${encodePath(path)}${params}`);
	if (Array.isArray(data) || data.type !== 'file') {
		throw new Error(`Path "${path}" is not a file in ${repo}.`);
	}

	const raw = Buffer.from(data.content, 'base64');
	const text = raw.toString('utf-8');
	const isText = !text.includes('\u0000');

	return {
		path: data.path,
		ref: ref ?? null,
		size: data.size,
		encoding: isText ? 'utf-8' : 'base64',
		content: isText ? truncate(text, 60_000) : data.content,
		html_url: data.html_url,
	};
}

export async function createIssue(
	token: string,
	repo: string,
	input: CreateIssueInput,
): Promise<{ number: number; html_url: string }> {
	const data = await githubFetchJson<{ number: number; html_url: string }>(token, `/repos/${repo}/issues`, {
		method: 'POST',
		body: JSON.stringify(input),
	});
	return { number: data.number, html_url: data.html_url };
}

export async function createPullRequest(
	token: string,
	repo: string,
	input: CreatePullRequestInput,
): Promise<{ number: number; html_url: string }> {
	const data = await githubFetchJson<{ number: number; html_url: string }>(token, `/repos/${repo}/pulls`, {
		method: 'POST',
		body: JSON.stringify(input),
	});
	return { number: data.number, html_url: data.html_url };
}

export async function createIssueOrPullRequestComment(
	token: string,
	repo: string,
	number: number,
	body: string,
): Promise<{ id: number; html_url: string }> {
	const data = await githubFetchJson<{ id: number; html_url: string }>(
		token,
		`/repos/${repo}/issues/${number}/comments`,
		{
			method: 'POST',
			body: JSON.stringify({ body }),
		},
	);
	return { id: data.id, html_url: data.html_url };
}

async function githubFetchJson<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
	const res = await githubFetch(token, path, init);
	return res.json() as Promise<T>;
}

async function githubFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
	const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
	const res = await fetch(url, {
		...init,
		signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			...init.headers,
		},
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`GitHub API ${res.status} ${res.statusText}: ${truncate(body, 500)}`);
	}
	return res;
}

interface RawUser {
	login: string;
}

interface RawLabel {
	name: string;
}

interface RawIssue {
	number: number;
	title: string;
	state: 'open' | 'closed';
	html_url: string;
	user: RawUser | null;
	labels: RawLabel[];
	comments: number;
	created_at: string;
	updated_at: string;
	body?: string | null;
	assignees?: RawUser[];
	milestone?: { title: string } | null;
	pull_request?: unknown;
}

interface RawPullRequest extends RawIssue {
	draft: boolean;
	merged_at: string | null;
	additions?: number;
	deletions?: number;
	changed_files?: number;
	mergeable?: boolean | null;
	base: { ref: string };
	head: { ref: string };
}

interface RawComment {
	id: number;
	user: RawUser | null;
	created_at: string;
	body: string;
	html_url: string;
}

interface RawSearchResponse {
	items: Array<{
		number: number;
		title: string;
		state: 'open' | 'closed';
		html_url: string;
		updated_at: string;
		repository_url: string;
		pull_request?: unknown;
	}>;
}

interface RawFileContent {
	type: 'file' | 'dir' | 'symlink' | 'submodule';
	path: string;
	size: number;
	content: string;
	html_url: string;
}

function toIssueSummary(issue: RawIssue): GithubIssueSummary {
	return {
		number: issue.number,
		title: issue.title,
		state: issue.state,
		html_url: issue.html_url,
		user: issue.user?.login ?? null,
		labels: issue.labels.map((label) => label.name),
		comments: issue.comments,
		created_at: issue.created_at,
		updated_at: issue.updated_at,
		is_pull_request: !!issue.pull_request,
	};
}

function toPullRequestSummary(pr: RawPullRequest): GithubPullRequestSummary {
	return {
		number: pr.number,
		title: pr.title,
		state: pr.merged_at ? 'merged' : pr.state,
		html_url: pr.html_url,
		user: pr.user?.login ?? null,
		labels: pr.labels.map((label) => label.name),
		draft: pr.draft,
		base: pr.base.ref,
		head: pr.head.ref,
		created_at: pr.created_at,
		updated_at: pr.updated_at,
		merged_at: pr.merged_at,
	};
}

function toComment(comment: RawComment): GithubComment {
	return {
		id: comment.id,
		user: comment.user?.login ?? null,
		created_at: comment.created_at,
		body: truncate(comment.body, 4_000),
		html_url: comment.html_url,
	};
}

function clampPerPage(value: number | undefined): number {
	const requested = value ?? 20;
	return Math.max(1, Math.min(50, requested));
}

function truncate(text: string, max: number): string {
	if (text.length <= max) {
		return text;
	}
	return `${text.slice(0, max)}\n... [truncated ${text.length - max} characters]`;
}

function encodePath(path: string): string {
	return path
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
}

function extractRepoFromIssueUrl(url: string): string {
	const match = url.match(/repos\/([^/]+\/[^/]+)$/);
	return match?.[1] ?? '';
}

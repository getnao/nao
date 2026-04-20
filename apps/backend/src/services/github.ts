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

export function isGithubIntegrationAvailable(): boolean {
	return !!(env.CLOUD_GITHUB_CLIENT_ID && env.CLOUD_GITHUB_CLIENT_SECRET);
}

export function buildAuthorizationUrl(state: string): string {
	const params = new URLSearchParams({
		client_id: env.CLOUD_GITHUB_CLIENT_ID!,
		scope: 'repo',
		state,
	});
	return `${GITHUB_OAUTH_URL}/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
	const res = await fetch(`${GITHUB_OAUTH_URL}/access_token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			client_id: env.CLOUD_GITHUB_CLIENT_ID,
			client_secret: env.CLOUD_GITHUB_CLIENT_SECRET,
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
	execFileSync('git', ['clone', '--depth', '1', cloneUrl, targetDir], {
		timeout: 120_000,
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

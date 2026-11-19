import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, unknown> = {};

vi.mock('../../src/env', () => ({
	get env() {
		return mockEnv;
	},
}));

async function loadGithubService() {
	vi.resetModules();
	return import('../../src/services/github');
}

beforeEach(() => {
	Object.keys(mockEnv).forEach((key) => delete mockEnv[key]);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('GitHub URLs without GITHUB_BASE_URL', () => {
	it('targets github.com and its dedicated API host', async () => {
		mockEnv.GITHUB_CLIENT_ID = 'client-id';
		mockEnv.GITHUB_CLIENT_SECRET = 'client-secret';
		const github = await loadGithubService();

		expect(github.isGithubEnterprise()).toBe(false);
		expect(github.githubApiUrl()).toBe('https://api.github.com');
		expect(github.buildAuthorizationUrl('state')).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
		expect(github.authenticatedRepoUrl('tok', 'nao/context')).toBe(
			'https://x-access-token:tok@github.com/nao/context.git',
		);
		expect(github.githubNoreplyEmail('octocat', 1)).toBe('1+octocat@users.noreply.github.com');
	});
});

describe('GitHub URLs with a GitHub Enterprise GITHUB_BASE_URL', () => {
	beforeEach(() => {
		mockEnv.GITHUB_BASE_URL = 'https://ghe.example.com/';
		mockEnv.GITHUB_CLIENT_ID = 'client-id';
		mockEnv.GITHUB_CLIENT_SECRET = 'client-secret';
	});

	it('targets the enterprise OAuth and REST API endpoints', async () => {
		const github = await loadGithubService();

		expect(github.isGithubEnterprise()).toBe(true);
		expect(github.githubApiUrl()).toBe('https://ghe.example.com/api/v3');
		expect(github.buildAuthorizationUrl('state')).toMatch(
			/^https:\/\/ghe\.example\.com\/login\/oauth\/authorize\?/,
		);
	});

	it('builds clone URLs and noreply emails on the enterprise host', async () => {
		const github = await loadGithubService();

		expect(github.authenticatedRepoUrl('tok', 'nao/context')).toBe(
			'https://x-access-token:tok@ghe.example.com/nao/context.git',
		);
		expect(github.publicRepoUrl('nao/context')).toBe('https://ghe.example.com/nao/context.git');
		expect(github.githubNoreplyEmail('octocat')).toBe('octocat@users.noreply.ghe.example.com');
	});

	it('parses HTTPS and SSH remotes on the enterprise host only', async () => {
		const github = await loadGithubService();

		expect(github.parseGithubRemoteRepoFullName('https://ghe.example.com/nao/context.git')).toBe('nao/context');
		expect(github.parseGithubRemoteRepoFullName('git@ghe.example.com:nao/my.repo.git')).toBe('nao/my.repo');
		expect(github.parseGithubRemoteRepoFullName('https://github.com/nao/context.git')).toBeNull();
	});

	it('parses pull request URLs on the enterprise host only', async () => {
		const github = await loadGithubService();

		expect(github.parsePullRequestUrl('https://ghe.example.com/nao/context/pull/42')).toEqual({
			repo: 'nao/context',
			number: 42,
		});
		expect(github.parsePullRequestUrl('https://github.com/nao/context/pull/42')).toBeNull();
		expect(github.parsePullRequestUrl('https://ghe.example.com.evil.com/nao/context/pull/42')).toBeNull();
	});
});

describe('GITHUB_API_URL override', () => {
	it('takes precedence over the derived enterprise API URL', async () => {
		mockEnv.GITHUB_BASE_URL = 'https://ghe.example.com';
		mockEnv.GITHUB_API_URL = 'https://api.ghe.example.com/';
		const github = await loadGithubService();

		expect(github.githubApiUrl()).toBe('https://api.ghe.example.com');
	});

	it('also applies on github.com', async () => {
		mockEnv.GITHUB_API_URL = 'https://proxy.example.com/github';
		const github = await loadGithubService();

		expect(github.githubApiUrl()).toBe('https://proxy.example.com/github');
	});
});

describe('githubGraphqlUrl', () => {
	it.each([
		['github.com', {}, 'https://api.github.com/graphql'],
		['an enterprise host', { GITHUB_BASE_URL: 'https://ghe.example.com' }, 'https://ghe.example.com/api/graphql'],
		[
			'a REST API override',
			{ GITHUB_API_URL: 'https://ghe.example.com/api/v3/' },
			'https://ghe.example.com/api/graphql',
		],
	])('targets the GraphQL API of %s', async (_case, env, expected) => {
		Object.assign(mockEnv, env);
		const github = await loadGithubService();

		expect(github.githubGraphqlUrl()).toBe(expected);
	});
});

describe('listBranches', () => {
	it('pages through the branches and marks those last committed by the token user', async () => {
		const pages = [
			branchesPage([branchRef('alice/orders', 'alice'), branchRef('main', 'bob')], 'cursor-1'),
			branchesPage([branchRef('no-account', null)], null),
		];
		const fetchMock = vi.fn(async () => new Response(JSON.stringify(pages.shift())));
		vi.stubGlobal('fetch', fetchMock);
		const github = await loadGithubService();

		const branches = await github.listBranches('tok', 'nao/context');

		expect(branches?.map((branch) => [branch.name, branch.author?.login ?? null, branch.isMine])).toEqual([
			['alice/orders', 'alice', true],
			['main', 'bob', false],
			['no-account', null, false],
		]);
		expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).variables).toMatchObject({ after: 'cursor-1' });
	});

	it('gives up on a repository with too many branches to list them all, for git to list them', async () => {
		const fullPage = Array.from({ length: 100 }, (_, index) => branchRef(`branch-${index}`, 'bob'));
		vi.stubGlobal('fetch', async () => new Response(JSON.stringify(branchesPage(fullPage, 'next'))));
		const github = await loadGithubService();

		await expect(github.listBranches('tok', 'nao/context')).resolves.toBeNull();
	});

	it('fails when the repository is not visible to the token', async () => {
		vi.stubGlobal(
			'fetch',
			async () => new Response(JSON.stringify({ data: { viewer: { login: 'alice' }, repository: null } })),
		);
		const github = await loadGithubService();

		await expect(github.listBranches('tok', 'nao/private')).rejects.toThrow('nao/private');
	});
});

function branchesPage(nodes: unknown[], endCursor: string | null) {
	return {
		data: {
			viewer: { login: 'Alice' },
			repository: { refs: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes } },
		},
	};
}

function branchRef(name: string, login: string | null) {
	return {
		name,
		target: {
			oid: `${name}-sha`,
			committedDate: '2026-11-01T10:00:00Z',
			author: { name: login ?? 'Someone', user: login ? { login } : null },
		},
	};
}

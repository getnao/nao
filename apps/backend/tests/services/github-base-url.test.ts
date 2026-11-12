import { beforeEach, describe, expect, it, vi } from 'vitest';

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

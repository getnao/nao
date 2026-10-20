import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, unknown> = {};

vi.mock('../../src/env', () => ({
	get env() {
		return mockEnv;
	},
}));

beforeEach(() => {
	Object.keys(mockEnv).forEach((key) => delete mockEnv[key]);
});

describe('buildAuthorizationUrl', () => {
	it('requests repository read and write access', async () => {
		mockEnv.GITLAB_CLIENT_ID = 'client-id';
		mockEnv.GITLAB_CLIENT_SECRET = 'client-secret';
		const { buildAuthorizationUrl } = await loadGitlabService();

		const url = new URL(buildAuthorizationUrl('state'));

		expect(url.searchParams.get('scope')?.split(' ')).toEqual([
			'api',
			'read_user',
			'openid',
			'email',
			'read_repository',
			'write_repository',
		]);
	});
});

describe('parseMergeRequestUrl with a self-hosted GITLAB_BASE_URL under a subpath', () => {
	it.each([
		['parses a merge request URL nested under the base path', 'https://host.example.com/gitlab'],
		[
			'still parses correctly when GITLAB_BASE_URL has a double trailing slash',
			'https://host.example.com/gitlab//',
		],
	])('%s', async (_case, baseUrl) => {
		mockEnv.GITLAB_BASE_URL = baseUrl;
		const { parseMergeRequestUrl } = await loadGitlabService();

		expect(parseMergeRequestUrl('https://host.example.com/gitlab/group/project/-/merge_requests/5')).toEqual({
			repo: 'group/project',
			iid: 5,
		});
	});

	it('rejects a URL outside the configured base path', async () => {
		mockEnv.GITLAB_BASE_URL = 'https://host.example.com/gitlab';
		const { parseMergeRequestUrl } = await loadGitlabService();

		expect(parseMergeRequestUrl('https://host.example.com/other/group/project/-/merge_requests/5')).toBeNull();
	});
});

async function loadGitlabService() {
	vi.resetModules();
	return import('../../src/services/gitlab');
}

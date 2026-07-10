import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, unknown> = {};

vi.mock('../src/env', () => ({
	get env() {
		return mockEnv;
	},
}));

async function loadGitlabService() {
	vi.resetModules();
	return import('../src/services/gitlab');
}

describe('parseMergeRequestUrl with a self-hosted GITLAB_BASE_URL under a subpath', () => {
	beforeEach(() => {
		Object.keys(mockEnv).forEach((key) => delete mockEnv[key]);
	});

	it('parses a merge request URL nested under the base path', async () => {
		mockEnv.GITLAB_BASE_URL = 'https://host.example.com/gitlab';
		const { parseMergeRequestUrl } = await loadGitlabService();

		expect(parseMergeRequestUrl('https://host.example.com/gitlab/group/project/-/merge_requests/5')).toEqual({
			repo: 'group/project',
			iid: 5,
		});
	});

	it('still parses correctly when GITLAB_BASE_URL has a double trailing slash', async () => {
		mockEnv.GITLAB_BASE_URL = 'https://host.example.com/gitlab//';
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

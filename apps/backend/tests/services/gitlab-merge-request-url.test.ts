import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, unknown> = {};

vi.mock('../../src/env', () => ({
	get env() {
		return mockEnv;
	},
}));

beforeEach(() => {
	Object.keys(mockEnv).forEach((key) => delete mockEnv[key]);
});

afterEach(() => {
	vi.unstubAllGlobals();
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

describe('listBranches', () => {
	it('pages through the branches and marks those last committed with an email of the token user', async () => {
		const responses = [
			jsonResponse({
				id: 1,
				username: 'alice',
				name: 'Alice',
				email: 'alice@example.com',
				commit_email: 'a@users.example.com',
			}),
			jsonResponse(
				[gitlabBranch('alice/orders', 'A@users.example.com'), gitlabBranch('main', 'bob@example.com')],
				'2',
			),
			jsonResponse([gitlabBranch('no-email', null)]),
		];
		const fetchMock = vi.fn(async () => responses.shift());
		vi.stubGlobal('fetch', fetchMock);
		const { listBranches } = await loadGitlabService();

		const branches = await listBranches('tok', 'group/project');

		expect(branches.map((branch) => [branch.name, branch.isMine])).toEqual([
			['alice/orders', true],
			['main', false],
			['no-email', false],
		]);
		expect(String(fetchMock.mock.calls[2]?.[0])).toContain('page=2');
	});
});

function jsonResponse(body: unknown, nextPage = ''): Response {
	return new Response(JSON.stringify(body), { headers: { 'x-next-page': nextPage } });
}

function gitlabBranch(name: string, authorEmail: string | null) {
	return {
		name,
		commit: {
			id: `${name}-sha`,
			author_name: 'Someone',
			author_email: authorEmail,
			committed_date: '2026-11-01T10:00:00Z',
		},
	};
}

async function loadGitlabService() {
	vi.resetModules();
	return import('../../src/services/gitlab');
}

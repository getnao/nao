import { afterEach, describe, expect, it, vi } from 'vitest';

import { findPullRequestByBranch } from '../src/services/github';
import { findMergeRequestByBranch, findOpenMergeRequest } from '../src/services/gitlab';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('review request branch lookup', () => {
	it('prefers an open GitHub pull request over a more recently updated closed one', async () => {
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const url = new URL(input.toString());
			const state = url.searchParams.get('state');
			return jsonResponse(
				state === 'open'
					? [githubPullRequest('https://github.com/nao/context/pull/2', 'open')]
					: [githubPullRequest('https://github.com/nao/context/pull/1', 'closed')],
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(findPullRequestByBranch('token', 'nao/context', 'nao/fix')).resolves.toEqual({
			url: 'https://github.com/nao/context/pull/2',
			state: 'open',
			mergedAt: null,
			closedAt: null,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('ignores an open GitLab merge request from a fork with the same branch name', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request) => {
				const url = new URL(input.toString());
				if (!url.pathname.endsWith('/merge_requests')) {
					return jsonResponse({ id: 101 });
				}
				return jsonResponse([
					gitLabMergeRequest('https://gitlab.com/fork/context/-/merge_requests/4', 202, 'opened'),
					gitLabMergeRequest('https://gitlab.com/nao/context/-/merge_requests/5', 101, 'opened'),
				]);
			}),
		);

		await expect(findOpenMergeRequest('token', 'nao/context', 'nao/fix')).resolves.toEqual({
			url: 'https://gitlab.com/nao/context/-/merge_requests/5',
		});
	});

	it('prefers an open GitLab merge request over a more recently updated closed one', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request) => {
				const url = new URL(input.toString());
				if (!url.pathname.endsWith('/merge_requests')) {
					return jsonResponse({ id: 101 });
				}
				return jsonResponse(
					url.searchParams.get('state') === 'opened'
						? [gitLabMergeRequest('https://gitlab.com/nao/context/-/merge_requests/2', 101, 'opened')]
						: [gitLabMergeRequest('https://gitlab.com/nao/context/-/merge_requests/1', 101, 'closed')],
				);
			}),
		);

		await expect(findMergeRequestByBranch('token', 'nao/context', 'nao/fix')).resolves.toEqual({
			url: 'https://gitlab.com/nao/context/-/merge_requests/2',
			state: 'open',
			mergedAt: null,
			closedAt: null,
		});
	});
});

function githubPullRequest(url: string, state: 'open' | 'closed') {
	return {
		html_url: url,
		state,
		merged_at: null,
		closed_at: state === 'closed' ? '2026-07-31T12:00:00.000Z' : null,
	};
}

function gitLabMergeRequest(url: string, sourceProjectId: number, state: 'opened' | 'closed') {
	return {
		web_url: url,
		source_project_id: sourceProjectId,
		state,
		merged_at: null,
		closed_at: state === 'closed' ? '2026-07-31T12:00:00.000Z' : null,
	};
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
}

import { describe, expect, it, vi } from 'vitest';

import { REVIEW_REQUEST_PROVIDERS, withSharedAccessToken } from '../../src/services/review-request-provider';

const REQUESTER = { name: 'Ada Lovelace', email: 'ada@example.com' };

describe('withSharedAccessToken', () => {
	it("acts with the shared token whoever asks, even without the provider's OAuth app", async () => {
		const provider = withSharedAccessToken(
			{ ...REVIEW_REQUEST_PROVIDERS.github, isIntegrationAvailable: () => false },
			'shared-token',
		);

		await expect(provider.getToken('any-user')).resolves.toBe('shared-token');
		expect(provider.isIntegrationAvailable()).toBe(true);
		expect(provider.commitCoAuthors(REQUESTER)).toEqual([REQUESTER]);
	});

	it('credits the requester in the review request body', async () => {
		const openReviewRequest = vi.fn(async () => ({
			kind: 'created' as const,
			url: 'https://github.com/a/b/pull/1',
		}));
		const provider = withSharedAccessToken(
			{ ...REVIEW_REQUEST_PROVIDERS.github, openReviewRequest },
			'shared-token',
		);

		await provider.openReviewRequest('shared-token', 'a/b', {
			title: 'Fix',
			head: 'nao/fix',
			base: 'main',
			body: '- Fix the revenue definition',
			requester: REQUESTER,
			pushOutput: '',
		});

		expect(openReviewRequest).toHaveBeenCalledWith(
			'shared-token',
			'a/b',
			expect.objectContaining({ body: '- Fix the revenue definition\n\nRequested by Ada Lovelace' }),
		);
	});

	it("does not mark every branch the shared account committed to as the user's", async () => {
		const branch = { name: 'nao/fix', commit: 'abc', author: null, committedAt: null, isMine: true };
		const provider = withSharedAccessToken(
			{ ...REVIEW_REQUEST_PROVIDERS.github, listBranches: async () => [branch] },
			'shared-token',
		);

		await expect(provider.listBranches('shared-token', 'a/b')).resolves.toEqual([{ ...branch, isMine: false }]);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredUserPreferences } from '../src/types/usage';

const mocks = vi.hoisted(() => ({
	env: { NAO_MODE: 'self-hosted', NAO_LICENSE: undefined as string | undefined },
	countUserWebConversations: vi.fn(),
	getUserPreferences: vi.fn(),
	mutateUserPreferences: vi.fn(),
	updateUserPreferences: vi.fn(),
}));

vi.mock('../src/env', () => ({ env: mocks.env }));
vi.mock('../src/queries/chat.queries', () => ({ countUserWebConversations: mocks.countUserWebConversations }));
vi.mock('../src/queries/user-preference.queries', () => ({
	getUserPreferences: mocks.getUserPreferences,
	mutateUserPreferences: mocks.mutateUserPreferences,
	updateUserPreferences: mocks.updateUserPreferences,
}));

const { dismissGithubStarPrompt, recordWebConversationStarted, shouldShowGithubStarPrompt } =
	await import('../src/services/github-star-prompt.service');

describe('GitHub star prompt', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.NAO_MODE = 'self-hosted';
		mocks.env.NAO_LICENSE = undefined;
		mocks.getUserPreferences.mockResolvedValue({});
		mocks.countUserWebConversations.mockResolvedValue(5);
	});

	describe('shouldShowGithubStarPrompt', () => {
		it('asks self-hosted users once they had five web conversations', async () => {
			await expect(shouldShowGithubStarPrompt('user-1')).resolves.toBe(true);
			expect(mocks.countUserWebConversations).toHaveBeenCalledWith('user-1');
		});

		it('waits until the fifth web conversation', async () => {
			mocks.countUserWebConversations.mockResolvedValue(4);
			await expect(shouldShowGithubStarPrompt('user-1')).resolves.toBe(false);
		});

		it('counts recorded conversations whose chats were deleted since', async () => {
			mocks.getUserPreferences.mockResolvedValue({ webConversationsStarted: 5 });
			mocks.countUserWebConversations.mockResolvedValue(1);
			await expect(shouldShowGithubStarPrompt('user-1')).resolves.toBe(true);
		});

		it('counts the chat history from before conversations were recorded', async () => {
			mocks.getUserPreferences.mockResolvedValue({ webConversationsStarted: 1 });
			mocks.countUserWebConversations.mockResolvedValue(5);
			await expect(shouldShowGithubStarPrompt('user-1')).resolves.toBe(true);
		});

		it('never asks cloud users', async () => {
			mocks.env.NAO_MODE = 'cloud';
			await expect(shouldShowGithubStarPrompt('user-1')).resolves.toBe(false);
			expect(mocks.countUserWebConversations).not.toHaveBeenCalled();
		});

		it('never asks Enterprise customers', async () => {
			mocks.env.NAO_LICENSE = 'license-token';
			await expect(shouldShowGithubStarPrompt('user-1')).resolves.toBe(false);
			expect(mocks.countUserWebConversations).not.toHaveBeenCalled();
		});

		it('never asks again once dismissed', async () => {
			mocks.getUserPreferences.mockResolvedValue({ githubStarPromptDismissedAt: 1 });
			await expect(shouldShowGithubStarPrompt('user-1')).resolves.toBe(false);
		});
	});

	describe('recordWebConversationStarted', () => {
		it('increments the recorded count in the user preferences', async () => {
			await recordWebConversationStarted('user-1');
			const transform = mocks.mutateUserPreferences.mock.calls[0][1] as (
				preferences: StoredUserPreferences,
			) => StoredUserPreferences;
			expect(mocks.mutateUserPreferences).toHaveBeenCalledWith('user-1', expect.any(Function));
			expect(transform({}).webConversationsStarted).toBe(1);
			expect(transform({ webConversationsStarted: 3 }).webConversationsStarted).toBe(4);
		});

		it('records nothing on cloud and Enterprise instances', async () => {
			mocks.env.NAO_LICENSE = 'license-token';
			await recordWebConversationStarted('user-1');
			expect(mocks.mutateUserPreferences).not.toHaveBeenCalled();
		});
	});

	it('stores the dismissal in the user preferences', async () => {
		await dismissGithubStarPrompt('user-1');
		expect(mocks.updateUserPreferences).toHaveBeenCalledWith('user-1', {
			githubStarPromptDismissedAt: expect.any(Number),
		});
	});
});

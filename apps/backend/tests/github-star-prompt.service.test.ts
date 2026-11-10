import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: { NAO_MODE: 'self-hosted', NAO_LICENSE: undefined as string | undefined },
	countUserConversations: vi.fn(),
	getUserPreferences: vi.fn(),
	updateUserPreferences: vi.fn(),
}));

vi.mock('../src/env', () => ({ env: mocks.env }));
vi.mock('../src/queries/chat.queries', () => ({ countUserConversations: mocks.countUserConversations }));
vi.mock('../src/queries/user-preference.queries', () => ({
	getUserPreferences: mocks.getUserPreferences,
	updateUserPreferences: mocks.updateUserPreferences,
}));

const { dismissGithubStarPrompt, shouldShowGithubStarPrompt } = await import(
	'../src/services/github-star-prompt.service'
);

describe('GitHub star prompt', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.NAO_MODE = 'self-hosted';
		mocks.env.NAO_LICENSE = undefined;
		mocks.getUserPreferences.mockResolvedValue({});
		mocks.countUserConversations.mockResolvedValue(5);
	});

	it('asks self-hosted users once they had five conversations', async () => {
		await expect(shouldShowGithubStarPrompt('user-1')).resolves.toBe(true);
		expect(mocks.countUserConversations).toHaveBeenCalledWith('user-1');
	});

	it('waits until the fifth conversation', async () => {
		mocks.countUserConversations.mockResolvedValue(4);
		await expect(shouldShowGithubStarPrompt('user-1')).resolves.toBe(false);
	});

	it('never asks cloud users', async () => {
		mocks.env.NAO_MODE = 'cloud';
		await expect(shouldShowGithubStarPrompt('user-1')).resolves.toBe(false);
		expect(mocks.countUserConversations).not.toHaveBeenCalled();
	});

	it('never asks Enterprise customers', async () => {
		mocks.env.NAO_LICENSE = 'license-token';
		await expect(shouldShowGithubStarPrompt('user-1')).resolves.toBe(false);
		expect(mocks.countUserConversations).not.toHaveBeenCalled();
	});

	it('never asks again once dismissed', async () => {
		mocks.getUserPreferences.mockResolvedValue({ githubStarPromptDismissedAt: 1 });
		await expect(shouldShowGithubStarPrompt('user-1')).resolves.toBe(false);
	});

	it('stores the dismissal in the user preferences', async () => {
		await dismissGithubStarPrompt('user-1');
		expect(mocks.updateUserPreferences).toHaveBeenCalledWith('user-1', {
			githubStarPromptDismissedAt: expect.any(Number),
		});
	});
});

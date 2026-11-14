import '../../src/env';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import * as contextRecommendationQueries from '../../src/queries/context-recommendation.queries';
import { REVIEW_REQUEST_PROVIDERS } from '../../src/services/review-request-provider';
import {
	getSharedGithubTokenStatus,
	removeSharedGithubToken,
	resolveRepositoryProvider,
	resolveRepositoryToken,
	saveSharedGithubToken,
} from '../../src/services/shared-github-token.service';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const PROJECT_ID = 'shared-token-project';
const BOT_ACCOUNT = { login: 'naoagent', avatar_url: 'https://avatars.example.com/naoagent' };

beforeAll(async () => {
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Shared token', type: 'local', path: '/tmp/shared' });
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await removeSharedGithubToken(PROJECT_ID);
});

describe('shared GitHub token', () => {
	it('stores the token encrypted and reports the account it belongs to', async () => {
		stubGithubUser(200);

		await expect(saveSharedGithubToken(PROJECT_ID, 'github_pat_secret')).resolves.toEqual({
			login: 'naoagent',
			avatarUrl: BOT_ACCOUNT.avatar_url,
		});

		const config = await contextRecommendationQueries.getConfig(PROJECT_ID);
		expect(config?.encryptedGithubAccessToken).toBeTruthy();
		expect(config?.encryptedGithubAccessToken).not.toContain('github_pat_secret');
		await expect(getSharedGithubTokenStatus(PROJECT_ID)).resolves.toEqual({
			configured: true,
			account: { login: 'naoagent', avatarUrl: BOT_ACCOUNT.avatar_url },
			error: null,
		});
	});

	it.each([
		[401, 'GitHub rejected this access token.'],
		[503, 'GitHub could not be reached to check this access token. Try again.'],
	])('does not save a token when GitHub answers %i', async (status, message) => {
		stubGithubUser(status);

		await expect(saveSharedGithubToken(PROJECT_ID, 'github_pat_unchecked')).rejects.toThrow(message);
		await expect(getSharedGithubTokenStatus(PROJECT_ID)).resolves.toEqual({ configured: false });
	});

	it('replaces every user token for GitHub repositories only', async () => {
		stubGithubUser(200);
		await saveSharedGithubToken(PROJECT_ID, 'github_pat_secret');

		await expect(resolveRepositoryToken(PROJECT_ID, 'github', 'user-without-github')).resolves.toBe(
			'github_pat_secret',
		);
		await expect(resolveRepositoryProvider(PROJECT_ID, 'gitlab')).resolves.toBe(REVIEW_REQUEST_PROVIDERS.gitlab);
	});

	it('falls back to personal accounts once the token is removed', async () => {
		stubGithubUser(200);
		await saveSharedGithubToken(PROJECT_ID, 'github_pat_secret');
		await removeSharedGithubToken(PROJECT_ID);

		await expect(resolveRepositoryProvider(PROJECT_ID, 'github')).resolves.toBe(REVIEW_REQUEST_PROVIDERS.github);
	});
});

function stubGithubUser(status: number): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(BOT_ACCOUNT), { status })),
	);
}

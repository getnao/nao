import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getProjectWarehouseCredentials: vi.fn(),
	upsertProjectWarehouseCredentials: vi.fn(),
	validateRepositoryAccess: vi.fn(),
}));

const storage = vi.hoisted(() => ({
	credentials: null as { provider: string; encryptedCredentials: string; updatedAt: Date } | null,
}));

vi.mock('../../src/queries/project-warehouse-credentials.queries', () => ({
	getProjectWarehouseCredentials: mocks.getProjectWarehouseCredentials,
	upsertProjectWarehouseCredentials: mocks.upsertProjectWarehouseCredentials,
}));

vi.mock('../../src/services/github', () => ({
	authenticatedRepoUrl: (token: string, repoFullName: string) =>
		`https://x-access-token:${token}@github.com/${repoFullName}.git`,
	validateRepositoryAccess: mocks.validateRepositoryAccess,
}));

vi.mock('../../src/utils/encryption', () => ({
	decryptSecret: (value: string) => value,
	encryptSecret: (value: string) => value,
}));

import {
	getProjectWarehouseCredentialsSummary,
	getProjectWarehouseEnvVars,
	ONBOARDING_GITHUB_REPOSITORY_URL_ENV,
	saveProjectWarehouseEnvVars,
	updateProjectGithubContextToken,
	updateProjectWarehouseCredentials,
} from '../../src/services/warehouse-credentials';

const DISABLED_GITHUB_REPOSITORY_URL = '"https://github.invalid/nao-access-revoked.git"';

beforeEach(() => {
	vi.clearAllMocks();
	mocks.validateRepositoryAccess.mockResolvedValue(undefined);
});

describe('project warehouse credentials', () => {
	it('stores a fine-grained GitHub token instead of the authenticated URL', async () => {
		await saveProjectWarehouseEnvVars(
			'project-1',
			'postgres',
			{
				POSTGRES_PASSWORD: '"warehouse-secret"',
				[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]:
					'"https://x-access-token:github-secret@github.com/acme/analytics.git"',
			},
			{
				githubConnection: {
					repoFullName: 'acme/analytics',
					accessToken: 'github_pat_project-token',
				},
			},
		);

		const encryptedPayload = mocks.upsertProjectWarehouseCredentials.mock.calls[0][2] as string;
		expect(JSON.parse(encryptedPayload)).toEqual({
			version: 3,
			envVars: { POSTGRES_PASSWORD: '"warehouse-secret"' },
			githubConnection: {
				repoFullName: 'acme/analytics',
				accessToken: 'github_pat_project-token',
			},
		});
		expect(encryptedPayload).not.toContain('https://x-access-token');
	});

	it('resolves the stored project token without using a personal GitHub account', async () => {
		mocks.getProjectWarehouseCredentials.mockResolvedValue({
			encryptedCredentials: JSON.stringify({
				version: 3,
				envVars: { POSTGRES_PASSWORD: '"warehouse-secret"' },
				githubConnection: {
					repoFullName: 'acme/analytics',
					accessToken: 'github_pat_project-token',
				},
			}),
		});

		await expect(getProjectWarehouseEnvVars('project-1')).resolves.toEqual({
			POSTGRES_PASSWORD: '"warehouse-secret"',
			[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]:
				'"https://x-access-token:github_pat_project-token@github.com/acme/analytics.git"',
		});
	});

	it('disables legacy personal GitHub connections until they are reconnected', async () => {
		mocks.getProjectWarehouseCredentials.mockResolvedValue({
			encryptedCredentials: JSON.stringify({
				version: 2,
				envVars: { POSTGRES_PASSWORD: '"warehouse-secret"' },
				githubConnection: {
					userId: 'user-1',
					repoFullName: 'acme/analytics',
				},
			}),
		});

		await expect(getProjectWarehouseEnvVars('project-1')).resolves.toEqual({
			POSTGRES_PASSWORD: '"warehouse-secret"',
			[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: DISABLED_GITHUB_REPOSITORY_URL,
		});
	});

	it('disables a revoked project GitHub token without invalidating the project', async () => {
		mocks.getProjectWarehouseCredentials.mockResolvedValue({
			encryptedCredentials: JSON.stringify({
				version: 3,
				envVars: {},
				githubConnection: {
					repoFullName: 'acme/analytics',
				},
			}),
		});

		await expect(getProjectWarehouseEnvVars('project-1')).resolves.toEqual({
			[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: DISABLED_GITHUB_REPOSITORY_URL,
		});
	});

	it('removes embedded GitHub URLs from legacy stored environments', async () => {
		mocks.getProjectWarehouseCredentials.mockResolvedValue({
			encryptedCredentials: JSON.stringify({
				version: 1,
				envVars: {
					POSTGRES_PASSWORD: '"warehouse-secret"',
					[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]:
						'"https://x-access-token:stale-token@github.com/acme/analytics.git"',
				},
			}),
		});

		await expect(getProjectWarehouseEnvVars('project-1')).resolves.toEqual({
			POSTGRES_PASSWORD: '"warehouse-secret"',
			[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: DISABLED_GITHUB_REPOSITORY_URL,
		});
	});
});

describe('warehouse credentials', () => {
	beforeEach(async () => {
		storage.credentials = null;
		mocks.getProjectWarehouseCredentials.mockImplementation(async () => storage.credentials);
		mocks.upsertProjectWarehouseCredentials.mockImplementation(
			async (_projectId: string, provider: string, encryptedCredentials: string) => {
				storage.credentials = { provider, encryptedCredentials, updatedAt: new Date() };
			},
		);
		await saveProjectWarehouseEnvVars('project-1', 'postgres', {
			NAO_ONBOARDING_POSTGRES_PASSWORD: '"secret"',
			NAO_ONBOARDING_POSTGRES_PORT: '5432',
		});
	});

	it('summarizes stored credentials without their values', async () => {
		const summary = await getProjectWarehouseCredentialsSummary('project-1');

		expect(summary).toMatchObject({
			provider: 'postgres',
			fields: [
				{ name: 'NAO_ONBOARDING_POSTGRES_PASSWORD', label: 'Password' },
				{ name: 'NAO_ONBOARDING_POSTGRES_PORT', label: 'Port' },
			],
		});
		expect(JSON.stringify(summary)).not.toContain('secret');
	});

	it('summarizes GitHub context without exposing its token', async () => {
		await saveProjectWarehouseEnvVars(
			'project-1',
			'postgres',
			{ NAO_ONBOARDING_POSTGRES_PASSWORD: '"secret"' },
			{
				githubConnection: {
					repoFullName: 'acme/analytics',
					accessToken: 'github_pat_project-token',
				},
			},
		);

		const summary = await getProjectWarehouseCredentialsSummary('project-1');

		expect(summary?.githubConnection).toEqual({
			repoFullName: 'acme/analytics',
			connected: true,
		});
		expect(JSON.stringify(summary)).not.toContain('github_pat_project-token');
	});

	it('replaces values while keeping the type they were stored with', async () => {
		await updateProjectWarehouseCredentials('project-1', {
			NAO_ONBOARDING_POSTGRES_PASSWORD: 'new-secret',
			NAO_ONBOARDING_POSTGRES_PORT: '5433',
		});

		expect(await getProjectWarehouseEnvVars('project-1')).toEqual({
			NAO_ONBOARDING_POSTGRES_PASSWORD: '"new-secret"',
			NAO_ONBOARDING_POSTGRES_PORT: '5433',
		});
	});

	it('rejects unknown credentials and values of the wrong type', async () => {
		await expect(
			updateProjectWarehouseCredentials('project-1', { NAO_ONBOARDING_POSTGRES_HOST: 'db.example.com' }),
		).rejects.toThrow('Unknown warehouse credential');
		await expect(
			updateProjectWarehouseCredentials('project-1', { NAO_ONBOARDING_POSTGRES_PORT: 'not-a-port' }),
		).rejects.toThrow('must be a number');
	});

	it('keeps the GitHub connection reference when credentials are updated', async () => {
		const githubConnection = {
			repoFullName: 'acme/analytics',
			accessToken: 'github_pat_project-token',
		};
		await saveProjectWarehouseEnvVars(
			'project-1',
			'postgres',
			{ NAO_ONBOARDING_POSTGRES_PASSWORD: '"secret"' },
			{ githubConnection },
		);

		await updateProjectWarehouseCredentials('project-1', { NAO_ONBOARDING_POSTGRES_PASSWORD: 'new-secret' });

		expect(JSON.parse(storage.credentials!.encryptedCredentials)).toEqual({
			version: 3,
			envVars: { NAO_ONBOARDING_POSTGRES_PASSWORD: '"new-secret"' },
			githubConnection,
		});
	});

	it('keeps the working GitHub token when a replacement lacks Contents access', async () => {
		await saveProjectWarehouseEnvVars(
			'project-1',
			'postgres',
			{ NAO_ONBOARDING_POSTGRES_PASSWORD: '"secret"' },
			{
				githubConnection: {
					repoFullName: 'acme/analytics',
					accessToken: 'github_pat_old-token',
				},
			},
		);
		mocks.validateRepositoryAccess.mockRejectedValueOnce(new Error('Forbidden'));

		await expect(updateProjectGithubContextToken('project-1', 'github_pat_new-token')).rejects.toThrow(
			'Could not access this repository',
		);
		expect(await getProjectWarehouseEnvVars('project-1')).toMatchObject({
			[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]:
				'"https://x-access-token:github_pat_old-token@github.com/acme/analytics.git"',
		});
	});

	it('validates replacement GitHub tokens and supports revocation', async () => {
		await saveProjectWarehouseEnvVars(
			'project-1',
			'postgres',
			{ NAO_ONBOARDING_POSTGRES_PASSWORD: '"secret"' },
			{
				githubConnection: {
					repoFullName: 'acme/analytics',
					accessToken: 'github_pat_old-token',
				},
			},
		);

		await updateProjectGithubContextToken('project-1', 'github_pat_new-token');

		expect(mocks.validateRepositoryAccess).toHaveBeenCalledWith('github_pat_new-token', 'acme/analytics');
		expect(await getProjectWarehouseEnvVars('project-1')).toMatchObject({
			[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]:
				'"https://x-access-token:github_pat_new-token@github.com/acme/analytics.git"',
		});

		await updateProjectGithubContextToken('project-1', null);

		expect(await getProjectWarehouseEnvVars('project-1')).toMatchObject({
			[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: DISABLED_GITHUB_REPOSITORY_URL,
		});
		expect(JSON.parse(storage.credentials!.encryptedCredentials).githubConnection).toEqual({
			repoFullName: 'acme/analytics',
		});
	});
});

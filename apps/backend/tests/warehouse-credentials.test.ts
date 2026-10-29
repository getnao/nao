import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getProjectWarehouseCredentials: vi.fn(),
	getUserRoleInProject: vi.fn(),
	getGithubToken: vi.fn(),
	upsertProjectWarehouseCredentials: vi.fn(),
}));

const storage = vi.hoisted(() => ({
	credentials: null as { provider: string; encryptedCredentials: string; updatedAt: Date } | null,
}));

vi.mock('../src/queries/project-warehouse-credentials.queries', () => ({
	getProjectWarehouseCredentials: mocks.getProjectWarehouseCredentials,
	upsertProjectWarehouseCredentials: mocks.upsertProjectWarehouseCredentials,
}));

vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
}));

vi.mock('../src/queries/user.queries', () => ({
	getGithubToken: mocks.getGithubToken,
}));

vi.mock('../src/utils/encryption', () => ({
	decryptSecret: (value: string) => value,
	encryptSecret: (value: string) => value,
}));

import {
	getProjectWarehouseCredentialsSummary,
	getProjectWarehouseEnvVars,
	ONBOARDING_GITHUB_REPOSITORY_URL_ENV,
	saveProjectWarehouseEnvVars,
	updateProjectWarehouseCredentials,
} from '../src/services/warehouse-credentials';

const DISABLED_GITHUB_REPOSITORY_URL = '"https://github.invalid/nao-access-revoked.git"';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('project warehouse credentials', () => {
	it('stores a GitHub connection reference without copying its token URL', async () => {
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
					userId: 'user-1',
					repoFullName: 'acme/analytics',
				},
			},
		);

		const encryptedPayload = mocks.upsertProjectWarehouseCredentials.mock.calls[0][2] as string;
		expect(JSON.parse(encryptedPayload)).toEqual({
			version: 2,
			envVars: { POSTGRES_PASSWORD: '"warehouse-secret"' },
			githubConnection: {
				userId: 'user-1',
				repoFullName: 'acme/analytics',
			},
		});
		expect(encryptedPayload).not.toContain('github-secret');
	});

	it('resolves the current token only while its user remains a project member', async () => {
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
		mocks.getUserRoleInProject.mockResolvedValue('admin');
		mocks.getGithubToken.mockResolvedValue('current-token');

		await expect(getProjectWarehouseEnvVars('project-1')).resolves.toEqual({
			POSTGRES_PASSWORD: '"warehouse-secret"',
			[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]:
				'"https://x-access-token:current-token@github.com/acme/analytics.git"',
		});
		expect(mocks.getUserRoleInProject).toHaveBeenCalledWith('project-1', 'user-1');
		expect(mocks.getGithubToken).toHaveBeenCalledWith('user-1');
	});

	it('disables GitHub access without invalidating the project after the user disconnects', async () => {
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
		mocks.getUserRoleInProject.mockResolvedValue('admin');
		mocks.getGithubToken.mockResolvedValue(null);

		await expect(getProjectWarehouseEnvVars('project-1')).resolves.toEqual({
			POSTGRES_PASSWORD: '"warehouse-secret"',
			[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: DISABLED_GITHUB_REPOSITORY_URL,
		});
	});

	it('disables GitHub access without invalidating the project after the user leaves', async () => {
		mocks.getProjectWarehouseCredentials.mockResolvedValue({
			encryptedCredentials: JSON.stringify({
				version: 2,
				envVars: {},
				githubConnection: {
					userId: 'user-1',
					repoFullName: 'acme/analytics',
				},
			}),
		});
		mocks.getUserRoleInProject.mockResolvedValue(null);

		await expect(getProjectWarehouseEnvVars('project-1')).resolves.toEqual({
			[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: DISABLED_GITHUB_REPOSITORY_URL,
		});
		expect(mocks.getGithubToken).not.toHaveBeenCalled();
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
		const githubConnection = { userId: 'user-1', repoFullName: 'acme/analytics' };
		await saveProjectWarehouseEnvVars(
			'project-1',
			'postgres',
			{ NAO_ONBOARDING_POSTGRES_PASSWORD: '"secret"' },
			{ githubConnection },
		);

		await updateProjectWarehouseCredentials('project-1', { NAO_ONBOARDING_POSTGRES_PASSWORD: 'new-secret' });

		expect(JSON.parse(storage.credentials!.encryptedCredentials)).toEqual({
			version: 2,
			envVars: { NAO_ONBOARDING_POSTGRES_PASSWORD: '"new-secret"' },
			githubConnection,
		});
	});
});

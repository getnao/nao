import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
	credentials: null as { provider: string; encryptedCredentials: string; updatedAt: Date } | null,
}));

vi.mock('../src/utils/encryption', () => ({
	encryptSecret: (value: string) => value,
	decryptSecret: (value: string) => value,
}));

vi.mock('../src/queries/project-warehouse-credentials.queries', () => ({
	getProjectWarehouseCredentials: vi.fn(async () => storage.credentials),
	upsertProjectWarehouseCredentials: vi.fn(
		async (_projectId: string, provider: string, encryptedCredentials: string) => {
			storage.credentials = { provider, encryptedCredentials, updatedAt: new Date() };
		},
	),
}));

import {
	getProjectWarehouseCredentialsSummary,
	getProjectWarehouseEnvVars,
	saveProjectWarehouseEnvVars,
	updateProjectWarehouseCredentials,
} from '../src/services/warehouse-credentials';

beforeEach(async () => {
	storage.credentials = null;
	await saveProjectWarehouseEnvVars('project-1', 'postgres', {
		NAO_ONBOARDING_POSTGRES_PASSWORD: '"secret"',
		NAO_ONBOARDING_POSTGRES_PORT: '5432',
	});
});

describe('warehouse credentials', () => {
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
});

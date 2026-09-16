import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {
		AZURE_AD_CLIENT_ID: 'client-id',
		AZURE_AD_CLIENT_SECRET: 'client-secret',
		AZURE_AD_TENANT_ID: 'tenant-id',
		AZURE_AD_GROUP_NAO_ROLE_MAPPING: 'a0b1c2d3-e4f5-6789-abcd-ef0123456789:admin',
	} as Record<string, string | undefined>,
	hasFeature: vi.fn(),
}));

vi.mock('../src/env', () => ({ env: mocks.env }));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { sso: 'sso' },
}));
vi.mock('../src/db/db', () => ({ db: {} }));

import { augmentSocialProvidersWithMicrosoft, type SocialProviders } from '../src/services/microsoft-auth.service';

beforeEach(() => {
	mocks.hasFeature.mockReset().mockResolvedValue(true);
});

describe('Microsoft Entra group access gate', () => {
	it('allows a direct mapped groups claim and denies a direct valid claim without a mapped group', async () => {
		const mapProfileToUser = getMapProfileToUser();

		await expect(mapProfileToUser({ groups: ['a0b1c2d3-e4f5-6789-abcd-ef0123456789'] })).resolves.toEqual({});
		await expect(mapProfileToUser({ groups: ['11111111-2222-3333-4444-555555555555'] })).rejects.toMatchObject({
			status: 'FORBIDDEN',
		});
	});

	it('fails open for an overage claim that requires the access token', async () => {
		await expect(getMapProfileToUser()({ hasgroups: true })).resolves.toEqual({});
	});
});

function getMapProfileToUser(): (profile: Record<string, unknown>) => Promise<Record<string, never>> {
	const providers: SocialProviders = {};
	augmentSocialProvidersWithMicrosoft(providers);
	const microsoft = providers.microsoft as {
		mapProfileToUser: (profile: Record<string, unknown>) => Promise<Record<string, never>>;
	};
	return microsoft.mapProfileToUser;
}

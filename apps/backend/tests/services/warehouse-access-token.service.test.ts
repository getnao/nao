import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getWarehouseAccessTokenForUser } from '../../src/services/warehouse-access-token.service';

const mocks = vi.hoisted(() => ({
	hasFeature: vi.fn(),
	getAzureAccessTokenForUser: vi.fn(),
	getOidcAccessTokenForUser: vi.fn(),
}));

vi.mock('../../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { sso: 'sso' },
}));
vi.mock('../../src/services/microsoft-auth.service', () => ({
	getAzureAccessTokenForUser: mocks.getAzureAccessTokenForUser,
}));
vi.mock('../../src/services/oidc-access-token.service', () => ({
	getOidcAccessTokenForUser: mocks.getOidcAccessTokenForUser,
}));

describe('getWarehouseAccessTokenForUser', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.hasFeature.mockResolvedValue(true);
		mocks.getAzureAccessTokenForUser.mockResolvedValue(null);
		mocks.getOidcAccessTokenForUser.mockResolvedValue(null);
	});

	it.each([
		['the Microsoft token first', 'azure-token', 'oidc-token', 'azure-token'],
		['the OIDC token without a Microsoft sign-in', null, 'oidc-token', 'oidc-token'],
		['null without any sign-in token', null, null, null],
	])('returns %s', async (_label, azureToken, oidcToken, expected) => {
		mocks.getAzureAccessTokenForUser.mockResolvedValue(azureToken);
		mocks.getOidcAccessTokenForUser.mockResolvedValue(oidcToken);

		await expect(getWarehouseAccessTokenForUser('user-id')).resolves.toBe(expected);
		expect(mocks.getAzureAccessTokenForUser).toHaveBeenCalledWith('user-id');
	});

	it('loads no token without an SSO license', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		mocks.getAzureAccessTokenForUser.mockResolvedValue('azure-token');

		await expect(getWarehouseAccessTokenForUser('user-id')).resolves.toBeNull();
		expect(mocks.hasFeature).toHaveBeenCalledWith('sso');
		expect(mocks.getAzureAccessTokenForUser).not.toHaveBeenCalled();
	});
});

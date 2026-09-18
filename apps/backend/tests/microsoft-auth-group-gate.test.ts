import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {
		AZURE_AD_CLIENT_ID: 'client-id',
		AZURE_AD_CLIENT_SECRET: 'client-secret',
		AZURE_AD_TENANT_ID: 'tenant-id',
		AZURE_AD_GROUP_NAO_ROLE_MAPPING: 'a0b1c2d3-e4f5-6789-abcd-ef0123456789:admin',
	} as Record<string, string | undefined>,
	hasFeature: vi.fn(),
	logger: {
		warn: vi.fn(),
	},
	microsoft: vi.fn(),
	resolveMicrosoftGraphMemberships: vi.fn(),
	stockGetUserInfo: vi.fn(),
}));

vi.mock('../src/env', () => ({ env: mocks.env }));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { sso: 'sso' },
}));
vi.mock('../src/services/microsoft-user-group-membership.service', () => ({
	resolveMicrosoftGraphMemberships: mocks.resolveMicrosoftGraphMemberships,
}));
vi.mock('../src/utils/logger', () => ({
	logger: mocks.logger,
	serializeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));
vi.mock('better-auth/social-providers', () => ({
	microsoft: mocks.microsoft,
}));
vi.mock('../src/db/db', () => ({ db: {} }));

import { augmentSocialProvidersWithMicrosoft, type SocialProviders } from '../src/services/microsoft-auth.service';

const MAPPED_GROUP = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';
const UNMAPPED_GROUP = '11111111-2222-3333-4444-555555555555';
const STOCK_USER_INFO = {
	user: {
		id: 'microsoft-user',
		emailVerified: true,
	},
	data: {
		sub: 'microsoft-user',
	},
};

beforeEach(() => {
	mocks.env.AZURE_AD_GROUP_NAO_ROLE_MAPPING = `${MAPPED_GROUP}:admin`;
	mocks.hasFeature.mockReset().mockResolvedValue(true);
	mocks.logger.warn.mockReset();
	mocks.resolveMicrosoftGraphMemberships.mockReset();
	mocks.stockGetUserInfo.mockReset().mockResolvedValue(STOCK_USER_INFO);
	mocks.microsoft.mockReset().mockReturnValue({
		getUserInfo: mocks.stockGetUserInfo,
	});
});

describe('Microsoft Entra group access gate', () => {
	it('allows a direct mapped groups claim before loading stock user info', async () => {
		const getUserInfo = createGetUserInfo();
		const token = { idToken: createIdToken({ groups: [MAPPED_GROUP] }), accessToken: 'access-token' };

		await expect(getUserInfo(token)).resolves.toEqual(STOCK_USER_INFO);
		expect(mocks.microsoft).toHaveBeenCalledWith({
			clientId: 'client-id',
			clientSecret: 'client-secret',
			tenantId: 'tenant-id',
		});
		expect(mocks.stockGetUserInfo).toHaveBeenCalledWith(token);
		expect(mocks.resolveMicrosoftGraphMemberships).not.toHaveBeenCalled();
	});

	it('denies a direct unmapped groups claim before loading stock user info', async () => {
		await expect(
			createGetUserInfo()({
				idToken: createIdToken({ groups: [UNMAPPED_GROUP] }),
				accessToken: 'access-token',
			}),
		).rejects.toMatchObject({
			status: 'FORBIDDEN',
		});
		expect(mocks.stockGetUserInfo).not.toHaveBeenCalled();
		expect(mocks.resolveMicrosoftGraphMemberships).not.toHaveBeenCalled();
	});

	it('allows an overage claim when Graph resolves a mapped group', async () => {
		mocks.resolveMicrosoftGraphMemberships.mockResolvedValue([MAPPED_GROUP]);
		const getUserInfo = createGetUserInfo();
		const token = { idToken: createIdToken({ hasgroups: true }), accessToken: 'access-token' };

		await expect(getUserInfo(token)).resolves.toEqual(STOCK_USER_INFO);
		expect(mocks.resolveMicrosoftGraphMemberships).toHaveBeenCalledWith('access-token', [MAPPED_GROUP]);
		expect(mocks.stockGetUserInfo).toHaveBeenCalledWith(token);
	});

	it('denies an overage claim when Graph resolves no mapped group', async () => {
		mocks.resolveMicrosoftGraphMemberships.mockResolvedValue([]);

		await expect(
			createGetUserInfo()({
				idToken: createIdToken({ _claim_names: { groups: 'src1' } }),
				accessToken: 'access-token',
			}),
		).rejects.toMatchObject({
			status: 'FORBIDDEN',
		});
		expect(mocks.stockGetUserInfo).not.toHaveBeenCalled();
	});

	it('denies an overage claim when Graph fails', async () => {
		mocks.resolveMicrosoftGraphMemberships.mockRejectedValue(new Error('Graph unavailable'));

		await expect(
			createGetUserInfo()({
				idToken: createIdToken({ hasgroups: true }),
				accessToken: 'access-token',
			}),
		).rejects.toMatchObject({
			status: 'FORBIDDEN',
			message: 'Microsoft group membership could not be verified.',
		});
		expect(mocks.logger.warn).toHaveBeenCalledOnce();
		expect(mocks.stockGetUserInfo).not.toHaveBeenCalled();
	});

	it('denies an overage claim without an access token', async () => {
		await expect(
			createGetUserInfo()({
				idToken: createIdToken({ hasgroups: true }),
			}),
		).rejects.toMatchObject({
			status: 'FORBIDDEN',
			message: 'Microsoft group membership could not be verified.',
		});
		expect(mocks.resolveMicrosoftGraphMemberships).not.toHaveBeenCalled();
		expect(mocks.stockGetUserInfo).not.toHaveBeenCalled();
	});

	it('allows sign-in without decoding when the mapping is unset', async () => {
		mocks.env.AZURE_AD_GROUP_NAO_ROLE_MAPPING = undefined;
		const getUserInfo = createGetUserInfo();

		await expect(getUserInfo({ accessToken: 'access-token' })).resolves.toEqual(STOCK_USER_INFO);
		expect(mocks.hasFeature).not.toHaveBeenCalled();
		expect(mocks.resolveMicrosoftGraphMemberships).not.toHaveBeenCalled();
	});

	it('allows sign-in without decoding when the SSO license is unavailable', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		const getUserInfo = createGetUserInfo();

		await expect(getUserInfo({ accessToken: 'access-token' })).resolves.toEqual(STOCK_USER_INFO);
		expect(mocks.resolveMicrosoftGraphMemberships).not.toHaveBeenCalled();
	});

	it('denies sign-in without an ID token when the gate is enabled', async () => {
		await expect(createGetUserInfo()({ accessToken: 'access-token' })).rejects.toMatchObject({
			status: 'FORBIDDEN',
			message: 'Microsoft sign-in did not return an ID token.',
		});
		expect(mocks.stockGetUserInfo).not.toHaveBeenCalled();
	});
});

function createGetUserInfo(): (token: { idToken?: string; accessToken?: string }) => Promise<unknown> {
	const providers: SocialProviders = {};
	augmentSocialProvidersWithMicrosoft(providers);
	const microsoft = providers.microsoft as {
		getUserInfo: (token: { idToken?: string; accessToken?: string }) => Promise<unknown>;
	};
	return microsoft.getUserInfo;
}

function createIdToken(payload: Record<string, unknown>): string {
	const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

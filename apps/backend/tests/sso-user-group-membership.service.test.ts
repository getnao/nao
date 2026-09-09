import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	hasFeature: vi.fn(),
	hasSyncState: vi.fn(),
	readClaims: vi.fn(),
	reconcile: vi.fn(),
	logger: {
		error: vi.fn(),
		warn: vi.fn(),
	},
}));

vi.mock('../src/env', () => ({ env: mocks.env }));
vi.mock('../src/services/oidc-auth.service', () => ({
	getOidcProviderId: () => 'okta',
	isOidcConfigured: () => true,
}));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { sso: 'sso', userGroups: 'user-groups' },
}));
vi.mock('../src/queries/sso-user-group-membership.queries', () => ({
	hasSsoUserGroupSyncState: mocks.hasSyncState,
	reconcileSsoUserGroupMemberships: mocks.reconcile,
}));
vi.mock('../src/services/sso-group-mapping.service', () => ({
	DEFAULT_GROUPS_CLAIM: 'groups',
}));
vi.mock('../src/services/sso-token.service', () => ({
	readClaimsFromIdToken: mocks.readClaims,
}));
vi.mock('../src/utils/logger', () => ({
	logger: mocks.logger,
	serializeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));

import { syncUserGroupsFromOidc } from '../src/services/sso-user-group-membership.service';

beforeEach(() => {
	mocks.env.OIDC_GROUPS_CLAIM = undefined;
	mocks.hasFeature.mockReset().mockResolvedValue(true);
	mocks.hasSyncState.mockReset().mockResolvedValue(true);
	mocks.readClaims.mockReset();
	mocks.reconcile.mockReset().mockResolvedValue(undefined);
	mocks.logger.error.mockReset();
	mocks.logger.warn.mockReset();
});

describe('syncUserGroupsFromOidc', () => {
	it('reconciles valid groups case-insensitively and treats an empty claim as authoritative', async () => {
		mocks.readClaims.mockResolvedValueOnce({ status: 'decoded', claims: { groups: ['Finance'] } });
		await syncUserGroupsFromOidc('user-1');
		expect(mocks.readClaims).toHaveBeenLastCalledWith('user-1', 'okta');
		expect(mocks.reconcile).toHaveBeenLastCalledWith('user-1', 'oidc', ['Finance']);

		mocks.readClaims.mockResolvedValueOnce({ status: 'decoded', claims: { groups: [] } });
		await syncUserGroupsFromOidc('user-1');
		expect(mocks.reconcile).toHaveBeenLastCalledWith('user-1', 'oidc', []);
	});

	it.each([
		['missing', { status: 'decoded', claims: {} }],
		['malformed', { status: 'decoded', claims: { groups: 42 } }],
		['undecodable', { status: 'undecodable' }],
		['no token', { status: 'no-token' }],
	])('preserves memberships when the claim is %s', async (_name, token) => {
		mocks.readClaims.mockResolvedValue(token);
		await expect(syncUserGroupsFromOidc('user-1')).resolves.toBeUndefined();
		expect(mocks.reconcile).not.toHaveBeenCalled();
		expect(mocks.logger.warn).toHaveBeenCalledOnce();
	});

	it('gates SSO and User Groups licenses independently', async () => {
		mocks.hasFeature.mockImplementation((feature: string) => Promise.resolve(feature !== 'sso'));
		await syncUserGroupsFromOidc('user-1');
		expect(mocks.hasFeature).toHaveBeenCalledTimes(1);
		expect(mocks.readClaims).not.toHaveBeenCalled();

		mocks.hasFeature
			.mockReset()
			.mockImplementation((feature: string) => Promise.resolve(feature !== 'user-groups'));
		await syncUserGroupsFromOidc('user-1');
		expect(mocks.hasFeature).toHaveBeenCalledTimes(2);
		expect(mocks.readClaims).not.toHaveBeenCalled();
	});

	it('skips when no mapping or stale membership exists', async () => {
		mocks.hasSyncState.mockResolvedValue(false);
		await syncUserGroupsFromOidc('user-1');
		expect(mocks.readClaims).not.toHaveBeenCalled();
	});

	it('logs failures without rejecting login', async () => {
		mocks.readClaims.mockRejectedValue(new Error('token read failed'));
		await expect(syncUserGroupsFromOidc('user-1')).resolves.toBeUndefined();
		expect(mocks.logger.error).toHaveBeenCalledWith('Failed to sync User Group memberships from OIDC', {
			source: 'system',
			context: { userId: 'user-1', error: { message: 'token read failed' } },
		});
	});
});

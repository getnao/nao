import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getLoginTokens: vi.fn(),
	hasFeature: vi.fn(),
	hasSyncState: vi.fn(),
	listIdentifiers: vi.fn(),
	reconcile: vi.fn(),
	decodeClaims: vi.fn(),
	fetch: vi.fn(),
	logger: {
		error: vi.fn(),
		warn: vi.fn(),
	},
}));

vi.mock('../src/queries/account.queries', () => ({
	getLoginTokens: mocks.getLoginTokens,
}));
vi.mock('../src/queries/sso-user-group-membership.queries', () => ({
	hasSsoUserGroupSyncState: mocks.hasSyncState,
	listConfiguredSsoGroupIdentifiers: mocks.listIdentifiers,
	reconcileSsoUserGroupMemberships: mocks.reconcile,
}));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { sso: 'sso', userGroups: 'user-groups' },
}));
vi.mock('../src/services/microsoft-auth.service', () => ({
	isMicrosoftConfigured: () => true,
}));
vi.mock('../src/services/sso-token.service', () => ({
	decodeIdTokenClaims: mocks.decodeClaims,
}));
vi.mock('../src/utils/logger', () => ({
	logger: mocks.logger,
	serializeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));

import {
	hasMicrosoftGroupsOverage,
	resolveMicrosoftGraphMemberships,
	syncUserGroupsFromMicrosoft,
} from '../src/services/microsoft-user-group-membership.service';

const GROUP_1 = 'A0B1C2D3-E4F5-6789-ABCD-EF0123456789';
const GROUP_2 = '11111111-2222-3333-4444-555555555555';

beforeEach(() => {
	mocks.getLoginTokens.mockReset().mockResolvedValue({
		idToken: 'id-token',
		accessToken: 'access-token',
		accessTokenExpiresAt: new Date(Date.now() + 60_000),
	});
	mocks.hasFeature.mockReset().mockResolvedValue(true);
	mocks.hasSyncState.mockReset().mockResolvedValue(true);
	mocks.listIdentifiers.mockReset().mockResolvedValue([GROUP_1, GROUP_2]);
	mocks.reconcile.mockReset().mockResolvedValue(undefined);
	mocks.decodeClaims.mockReset();
	mocks.fetch.mockReset();
	mocks.logger.error.mockReset();
	mocks.logger.warn.mockReset();
	vi.stubGlobal('fetch', mocks.fetch);
});

describe('syncUserGroupsFromMicrosoft', () => {
	it('uses a standard groups claim directly and normalizes GUIDs', async () => {
		mocks.decodeClaims.mockReturnValue({ status: 'decoded', claims: { groups: [GROUP_1, GROUP_1.toLowerCase()] } });

		await syncUserGroupsFromMicrosoft('user-1');

		expect(mocks.decodeClaims).toHaveBeenCalledWith('id-token');
		expect(mocks.reconcile).toHaveBeenCalledWith('user-1', 'microsoft', [GROUP_1.toLowerCase()]);
		expect(mocks.listIdentifiers).not.toHaveBeenCalled();
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it('treats a valid empty groups claim as authoritative', async () => {
		mocks.decodeClaims.mockReturnValue({ status: 'decoded', claims: { groups: [] } });
		await syncUserGroupsFromMicrosoft('user-1');
		expect(mocks.reconcile).toHaveBeenCalledWith('user-1', 'microsoft', []);
	});

	it.each([
		['missing', { status: 'decoded', claims: {} }],
		['malformed type', { status: 'decoded', claims: { groups: 42 } }],
		['malformed GUID', { status: 'decoded', claims: { groups: ['not-a-guid'] } }],
		['undecodable', { status: 'undecodable' }],
		['unavailable', { status: 'no-token' }],
	])('preserves memberships for %s Microsoft membership data', async (_name, token) => {
		mocks.decodeClaims.mockReturnValue(token);
		await expect(syncUserGroupsFromMicrosoft('user-1')).resolves.toBeUndefined();
		expect(mocks.reconcile).not.toHaveBeenCalled();
		expect(mocks.logger.warn).toHaveBeenCalledOnce();
	});

	it.each([{ _claim_names: { groups: 'src1' } }, { hasgroups: true }])(
		'resolves overage claims with Microsoft Graph',
		async (claims) => {
			mocks.decodeClaims.mockReturnValue({ status: 'decoded', claims });
			mocks.fetch.mockResolvedValue(graphResponse([GROUP_2]));

			await syncUserGroupsFromMicrosoft('user-1');

			expect(mocks.reconcile).toHaveBeenCalledWith('user-1', 'microsoft', [GROUP_2.toLowerCase()]);
		},
	);

	it('clears stale rows without Graph when overage has no configured candidates', async () => {
		mocks.decodeClaims.mockReturnValue({ status: 'decoded', claims: { hasgroups: true } });
		mocks.listIdentifiers.mockResolvedValue([]);

		await syncUserGroupsFromMicrosoft('user-1');

		expect(mocks.fetch).not.toHaveBeenCalled();
		expect(mocks.reconcile).toHaveBeenCalledWith('user-1', 'microsoft', []);
	});

	it('preserves rows when the Microsoft access token is unavailable or expired', async () => {
		mocks.decodeClaims.mockReturnValue({ status: 'decoded', claims: { hasgroups: true } });
		mocks.getLoginTokens.mockResolvedValue({
			idToken: 'id-token',
			accessToken: 'expired',
			accessTokenExpiresAt: new Date(Date.now() - 1),
		});

		await syncUserGroupsFromMicrosoft('user-1');

		expect(mocks.fetch).not.toHaveBeenCalled();
		expect(mocks.reconcile).not.toHaveBeenCalled();
	});

	it('preserves rows when any Graph batch fails', async () => {
		mocks.decodeClaims.mockReturnValue({ status: 'decoded', claims: { hasgroups: true } });
		mocks.listIdentifiers.mockResolvedValue(createGroupIds(21));
		mocks.fetch.mockResolvedValueOnce(graphResponse([])).mockResolvedValueOnce(graphResponse([], 403));

		await expect(syncUserGroupsFromMicrosoft('user-1')).resolves.toBeUndefined();

		expect(mocks.fetch).toHaveBeenCalledTimes(2);
		expect(mocks.reconcile).not.toHaveBeenCalled();
		expect(mocks.logger.error).toHaveBeenCalledOnce();
	});

	it('requires SSO and does not query unlimited-groups entitlement', async () => {
		mocks.hasFeature.mockImplementation((feature: string) => Promise.resolve(feature !== 'sso'));
		await syncUserGroupsFromMicrosoft('user-1');
		expect(mocks.hasFeature).toHaveBeenCalledTimes(1);
		expect(mocks.getLoginTokens).not.toHaveBeenCalled();

		mocks.hasFeature
			.mockReset()
			.mockImplementation((feature: string) => Promise.resolve(feature !== 'user-groups'));
		mocks.decodeClaims.mockReturnValue({ status: 'decoded', claims: { groups: [GROUP_1] } });
		await syncUserGroupsFromMicrosoft('user-1');
		expect(mocks.hasFeature).toHaveBeenCalledOnce();
		expect(mocks.hasFeature).toHaveBeenCalledWith('sso');
		expect(mocks.reconcile).toHaveBeenCalledWith('user-1', 'microsoft', [GROUP_1.toLowerCase()]);
	});

	it('skips when no mapping or stale Microsoft membership exists', async () => {
		mocks.hasSyncState.mockResolvedValue(false);
		await syncUserGroupsFromMicrosoft('user-1');
		expect(mocks.getLoginTokens).not.toHaveBeenCalled();
	});
});

describe('Microsoft group overage detection', () => {
	it('detects claim-name and hasgroups indicators without trusting endpoints', () => {
		expect(hasMicrosoftGroupsOverage({ _claim_names: { groups: 'src1' } })).toBe(true);
		expect(hasMicrosoftGroupsOverage({ hasgroups: true })).toBe(true);
		expect(
			hasMicrosoftGroupsOverage({
				_claim_sources: { src1: { endpoint: 'https://untrusted.example/groups' } },
			}),
		).toBe(false);
	});
});

describe('resolveMicrosoftGraphMemberships', () => {
	it('batches at 20 IDs and sends the exact request shape', async () => {
		const ids = createGroupIds(21);
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(graphResponse([ids[0]]))
			.mockResolvedValueOnce(graphResponse([ids[20]]));

		await expect(resolveMicrosoftGraphMemberships('token', ids, fetcher)).resolves.toEqual([ids[0], ids[20]]);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(fetcher.mock.calls[0]?.[0]).toBe('https://graph.microsoft.com/v1.0/me/checkMemberObjects');
		expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
			method: 'POST',
			headers: {
				Authorization: 'Bearer token',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ ids: ids.slice(0, 20) }),
		});
		expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
			body: JSON.stringify({ ids: ids.slice(20) }),
		});
	});

	it.each([401, 403, 500])('rejects Graph status %s', async (status) => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(graphResponse([], status));
		await expect(resolveMicrosoftGraphMemberships('token', [GROUP_1], fetcher)).rejects.toThrow(`status ${status}`);
	});

	it('rejects fetch failures, malformed JSON, and malformed responses', async () => {
		await expect(
			resolveMicrosoftGraphMemberships(
				'token',
				[GROUP_1],
				vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout')),
			),
		).rejects.toThrow('timeout');
		await expect(
			resolveMicrosoftGraphMemberships(
				'token',
				[GROUP_1],
				vi.fn<typeof fetch>().mockResolvedValue({
					ok: true,
					json: () => Promise.reject(new SyntaxError('bad json')),
				} as Response),
			),
		).rejects.toThrow('bad json');
		for (const value of [{}, { value: 'wrong' }, { value: ['not-a-guid'] }, { value: [GROUP_2] }]) {
			await expect(
				resolveMicrosoftGraphMemberships(
					'token',
					[GROUP_1],
					vi.fn<typeof fetch>().mockResolvedValue(graphResponseValue(value)),
				),
			).rejects.toThrow('malformed');
		}
	});
});

function createGroupIds(count: number): string[] {
	return Array.from(
		{ length: count },
		(_, index) => `00000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}`,
	);
}

function graphResponse(value: string[], status = 200): Response {
	return graphResponseValue({ value }, status);
}

function graphResponseValue(value: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(value),
	} as Response;
}

import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { getOidcAccessTokenForUser, MIN_ACCESS_TOKEN_VALIDITY_MS } from '../../src/services/oidc-access-token.service';

const oidc = vi.hoisted(() => ({ configured: true, cloud: false, assertSafeHost: vi.fn() }));

vi.mock('../../src/env', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/env')>();
	return {
		...actual,
		env: {
			...actual.env,
			OIDC_CLIENT_ID: 'client-id',
			OIDC_CLIENT_SECRET: 'client-secret',
			OIDC_DISCOVERY_URL: 'https://acme.okta.com/oauth2/aus1/.well-known/openid-configuration',
		},
		get isCloud() {
			return oidc.cloud;
		},
	};
});
vi.mock('../../src/services/oidc-auth.service', () => ({
	getOidcProviderId: () => 'okta',
	isOidcConfigured: () => oidc.configured,
}));
vi.mock('../../src/utils/safe-fetch', () => ({ assertSafeHost: oidc.assertSafeHost }));
vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});
vi.mock('../../src/utils/logger', async () => ({
	...(await import('../helpers/logger-mock')),
	serializeError: (error: unknown) => error,
}));

const USER_ID = 'okta-user';
const PROJECT_ID = 'okta-project';
const ORG_ID = 'okta-org';
const ORG_PROVIDER_ID = 'sso-acme';
const ORG_TOKEN_ENDPOINT = 'https://acme.okta.com/oauth2/aus2/v1/token';
const ACCOUNT_ID = 'okta-account';
const DISCOVERY_URL = 'https://acme.okta.com/oauth2/aus1/.well-known/openid-configuration';
const TOKEN_ENDPOINT = 'https://acme.okta.com/oauth2/aus1/v1/token';
const ONE_HOUR_MS = 60 * 60 * 1000;

const fetchMock = vi.fn<typeof fetch>();

describe('getOidcAccessTokenForUser', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({ id: USER_ID, name: 'Ada', email: 'ada@acme.com' }).execute();
		await db.insert(s.organization).values({ id: ORG_ID, name: 'Acme', slug: 'acme' }).execute();
		await db
			.insert(s.project)
			.values({ id: PROJECT_ID, name: 'Acme', type: 'local', path: '/tmp/acme', orgId: ORG_ID })
			.execute();
		await db
			.insert(s.ssoProvider)
			.values({
				providerId: ORG_PROVIDER_ID,
				organizationId: ORG_ID,
				issuer: 'https://acme.okta.com/oauth2/aus2',
				domain: 'acme.com',
				domainVerified: true,
				oidcConfig: JSON.stringify({
					clientId: 'org-client-id',
					clientSecret: 'org-client-secret',
					tokenEndpoint: ORG_TOKEN_ENDPOINT,
					tokenEndpointAuthentication: 'client_secret_basic',
				}),
			})
			.execute();
	});

	beforeEach(async () => {
		oidc.configured = true;
		oidc.cloud = false;
		oidc.assertSafeHost.mockReset().mockResolvedValue(undefined);
		await db.delete(s.account).execute();
		fetchMock.mockReset();
		fetchMock.mockImplementation(respondLikeOkta({ access_token: 'fresh-token', expires_in: 3600 }));
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('returns the stored token while it stays valid long enough', async () => {
		await insertAccount({ accessTokenExpiresAt: new Date(Date.now() + ONE_HOUR_MS) });

		await expect(getOidcAccessTokenForUser(USER_ID, PROJECT_ID)).resolves.toBe('stored-token');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		['a rotated refresh token', { refresh_token: 'rotated-refresh' }, 'rotated-refresh'],
		['the same refresh token', {}, 'stored-refresh'],
	])('refreshes a token about to expire and saves %s', async (_label, rotation, savedRefreshToken) => {
		fetchMock.mockImplementation(respondLikeOkta({ access_token: 'fresh-token', expires_in: 3600, ...rotation }));
		await insertAccount({ accessTokenExpiresAt: new Date(Date.now() + MIN_ACCESS_TOKEN_VALIDITY_MS - 1000) });

		await expect(getOidcAccessTokenForUser(USER_ID, PROJECT_ID)).resolves.toBe('fresh-token');

		const [account] = await db.select().from(s.account).where(eq(s.account.id, ACCOUNT_ID));
		expect(account.accessToken).toBe('fresh-token');
		expect(account.refreshToken).toBe(savedRefreshToken);
		expect(account.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + ONE_HOUR_MS - 60_000);
		const [tokenUrl, tokenRequest] = fetchMock.mock.calls.find(([url]) => String(url) === TOKEN_ENDPOINT)!;
		expect(String(tokenUrl)).toBe(TOKEN_ENDPOINT);
		expect(String(tokenRequest?.body)).toContain('refresh_token=stored-refresh');
	});

	it('shares one refresh between concurrent runs', async () => {
		await insertAccount({ accessTokenExpiresAt: new Date(Date.now() - 1000) });

		const tokens = await Promise.all([
			getOidcAccessTokenForUser(USER_ID, PROJECT_ID),
			getOidcAccessTokenForUser(USER_ID, PROJECT_ID),
		]);

		expect(tokens).toEqual(['fresh-token', 'fresh-token']);
		expect(fetchMock.mock.calls.filter(([url]) => String(url) === TOKEN_ENDPOINT)).toHaveLength(1);
	});

	it.each([
		[
			'OIDC is not configured',
			() => {
				oidc.configured = false;
			},
		],
		['the user never signed in with OIDC', () => db.delete(s.account).execute()],
		['no refresh token was stored', () => db.update(s.account).set({ refreshToken: null }).execute()],
	])('returns null when %s', async (_label, arrange) => {
		await insertAccount({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
		await arrange();

		await expect(getOidcAccessTokenForUser(USER_ID, PROJECT_ID)).resolves.toBeNull();
	});

	it("refreshes against the organization's SSO on nao Cloud", async () => {
		oidc.configured = false;
		oidc.cloud = true;
		await insertAccount({ providerId: ORG_PROVIDER_ID, accessTokenExpiresAt: new Date(Date.now() - 1000) });

		await expect(getOidcAccessTokenForUser(USER_ID, PROJECT_ID)).resolves.toBe('fresh-token');

		const [tokenUrl, tokenRequest] = fetchMock.mock.calls[0];
		expect(String(tokenUrl)).toBe(ORG_TOKEN_ENDPOINT);
		expect(new Headers(tokenRequest?.headers).get('authorization')).toBe(
			`Basic ${Buffer.from('org-client-id:org-client-secret').toString('base64')}`,
		);
	});

	it("never sends the refresh token to an organization's token endpoint that now resolves inside the network", async () => {
		oidc.configured = false;
		oidc.cloud = true;
		oidc.assertSafeHost.mockRejectedValue(new Error('private address'));
		vi.useFakeTimers({ toFake: ['setTimeout'] });
		await insertAccount({ providerId: ORG_PROVIDER_ID, accessTokenExpiresAt: new Date(Date.now() - 1000) });

		const token = getOidcAccessTokenForUser(USER_ID, PROJECT_ID);
		await vi.runAllTimersAsync();

		await expect(token).resolves.toBeNull();
		expect(oidc.assertSafeHost).toHaveBeenCalledWith('acme.okta.com');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not save a refreshed token over one cleared while the refresh was in flight', async () => {
		await insertAccount({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
		fetchMock.mockImplementation(async (input) => {
			if (String(input) === DISCOVERY_URL) {
				return Response.json({ token_endpoint: TOKEN_ENDPOINT });
			}
			await db.update(s.account).set({ accessToken: null, refreshToken: null }).execute();
			return Response.json({ access_token: 'fresh-token', refresh_token: 'rotated-refresh', expires_in: 3600 });
		});

		await getOidcAccessTokenForUser(USER_ID, PROJECT_ID);

		const [account] = await db.select().from(s.account).where(eq(s.account.id, ACCOUNT_ID));
		expect(account).toMatchObject({ accessToken: null, refreshToken: null });
	});

	it('uses the token another replica saved after redeeming the same refresh token first', async () => {
		await insertAccount({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
		fetchMock.mockImplementation(async (input) => {
			if (String(input) === DISCOVERY_URL) {
				return Response.json({ token_endpoint: TOKEN_ENDPOINT });
			}
			await db
				.update(s.account)
				.set({
					accessToken: 'other-replica-token',
					accessTokenExpiresAt: new Date(Date.now() + ONE_HOUR_MS),
					refreshToken: 'other-replica-refresh',
				})
				.execute();
			return Response.json({ error: 'invalid_grant' }, { status: 400 });
		});

		await expect(getOidcAccessTokenForUser(USER_ID, PROJECT_ID)).resolves.toBe('other-replica-token');
	});

	it('returns null when the provider rejects the refresh token and no replica rotated it', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout'] });
		fetchMock.mockImplementation(respondLikeOkta({ error: 'invalid_grant' }, 400));
		await insertAccount({ accessTokenExpiresAt: new Date(Date.now() - 1000) });

		const token = getOidcAccessTokenForUser(USER_ID, PROJECT_ID);
		await vi.runAllTimersAsync();

		await expect(token).resolves.toBeNull();
	});
});

async function insertAccount(values: { accessTokenExpiresAt: Date; providerId?: string }) {
	await db
		.insert(s.account)
		.values({
			id: ACCOUNT_ID,
			accountId: 'okta-subject',
			providerId: 'okta',
			userId: USER_ID,
			accessToken: 'stored-token',
			refreshToken: 'stored-refresh',
			...values,
		})
		.execute();
}

function respondLikeOkta(tokenResponse: Record<string, unknown>, tokenStatus = 200) {
	return async (input: string | URL | Request) => {
		const url = String(input instanceof Request ? input.url : input);
		if (url === DISCOVERY_URL) {
			return Response.json({ token_endpoint: TOKEN_ENDPOINT });
		}
		return Response.json(tokenResponse, { status: tokenStatus });
	};
}

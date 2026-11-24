/* @license Enterprise */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const originalEnv = { ...process.env };
	process.env.NAO_MODE = 'cloud';
	process.env.BETTER_AUTH_URL = 'http://localhost:5005';
	process.env.BETTER_AUTH_SECRET = 'cloud-sso-test-secret-at-least-32-characters';
	process.env.ENABLE_USER_SIGNUP = 'true';
	process.env.CLOUD_GITHUB_PROJECT_ORG = 'test-org';
	process.env.CLOUD_GITHUB_PROJECT_APP_ID = '123';
	process.env.CLOUD_GITHUB_PROJECT_INSTALLATION_ID = '456';
	process.env.CLOUD_GITHUB_PROJECT_PRIVATE_KEY = 'test-private-key';
	return { originalEnv, hasFeature: vi.fn() };
});

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});
vi.mock('../../src/services/license.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/license.service')>()),
	hasFeature: mocks.hasFeature,
}));
vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

import { eq } from 'drizzle-orm';

import { getAuth, updateAuth } from '../../src/auth';
import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import * as ssoProviderQueries from '../../src/queries/sso-provider.queries';
import { getWarehouseAccessTokenForUser } from '../../src/services/warehouse-access-token.service';

const BASE_URL = 'http://localhost:5005';
const ORG_ID = 'org-acme';
const PROVIDER_ID = 'sso-acme';
const OKTA = 'https://acme.okta.com';
const TOKEN_ENDPOINT = `${OKTA}/oauth2/v1/token`;
const USERINFO_ENDPOINT = `${OKTA}/oauth2/v1/userinfo`;

const OIDC_CONFIG = {
	issuer: OKTA,
	discoveryEndpoint: `${OKTA}/.well-known/openid-configuration`,
	authorizationEndpoint: `${OKTA}/oauth2/v1/authorize`,
	tokenEndpoint: TOKEN_ENDPOINT,
	jwksEndpoint: `${OKTA}/oauth2/v1/keys`,
	userInfoEndpoint: USERINFO_ENDPOINT,
	clientId: 'okta-client',
	clientSecret: 'okta-client-secret',
	pkce: true,
	scopes: ['openid', 'profile', 'email'],
};

let requestCount = 0;

describe('cloud organization SSO sign-in', () => {
	let oktaProfile: Record<string, unknown>;

	beforeEach(async () => {
		mocks.hasFeature.mockReset().mockResolvedValue(true);
		oktaProfile = { sub: 'okta-jane', email: 'jane@acme.com', name: 'Jane' };
		vi.stubGlobal(
			'fetch',
			stubOktaFetch(() => oktaProfile),
		);
		await clearData();
		await seedOrganizationWithProvider();
		updateAuth();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	afterAll(async () => {
		await clearData();
		process.env = mocks.originalEnv;
		updateAuth();
	});

	it('stores the OIDC config encrypted and reads it back for the plugin', async () => {
		const [raw] = await db.$client
			.prepare('select oidc_config from sso_provider where provider_id = ?')
			.raw()
			.all(PROVIDER_ID);
		const provider = await ssoProviderQueries.getSsoProviderByProviderId(PROVIDER_ID);

		expect(String(raw)).not.toContain('okta-client-secret');
		expect(JSON.parse(provider?.oidcConfig ?? '{}')).toMatchObject({ clientSecret: 'okta-client-secret' });
	});

	it('redirects to the organization IdP chosen from the email domain', async () => {
		const { url } = await startSignIn({ email: 'jane@eu.acme.com' });

		const authorizationUrl = new URL(url);
		expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(`${OKTA}/oauth2/v1/authorize`);
		expect(authorizationUrl.searchParams.get('client_id')).toBe('okta-client');
		expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
			`${BASE_URL}/api/auth/sso/callback/${PROVIDER_ID}`,
		);
	});

	it.each([
		{ name: 'no organization uses SSO on the email domain', email: 'bob@unknown-corp.com', setup: () => undefined },
		{
			name: 'the organization license does not include SSO',
			email: 'jane@acme.com',
			setup: () => mocks.hasFeature.mockResolvedValue(false),
		},
		{
			name: 'the organization admin has not connected the IdP yet',
			email: 'jane@acme.com',
			setup: () => db.update(s.ssoProvider).set({ issuer: '', oidcConfig: null }),
		},
	])('refuses a sign-in with the same answer when $name', async ({ email, setup }) => {
		await setup();

		const response = await callAuth('/sign-in/sso', { email, callbackURL: '/' });

		expect(response.status).toBe(403);
		expect(((await response.json()) as { message: string }).message).toBe(
			"We couldn't sign you in with SSO. Check your email or contact your admin.",
		);
	});

	it('adds a new IdP user to the organization with a verified email instead of a personal organization', async () => {
		await completeSignIn();

		const user = await findUser('jane@acme.com');
		expect(user?.emailVerified).toBe(true);
		expect(await listMembershipOrgIds(user!.id)).toEqual([ORG_ID]);
	});

	it('links an existing verified account and adds it to the organization', async () => {
		await db
			.insert(s.user)
			.values({ id: 'existing-jane', name: 'Jane', email: 'jane@acme.com', emailVerified: true });

		await completeSignIn();

		const accounts = await db.select().from(s.account).where(eq(s.account.userId, 'existing-jane'));
		expect(accounts.map((account) => account.providerId)).toEqual([PROVIDER_ID]);
		expect(await listMembershipOrgIds('existing-jane')).toEqual([ORG_ID]);
	});

	it('never links an existing account whose email is outside the provider domains', async () => {
		await db.insert(s.user).values({ id: 'outsider', name: 'Out', email: 'out@other.com', emailVerified: true });
		oktaProfile = { sub: 'okta-out', email: 'out@other.com', name: 'Out' };

		const location = await completeSignIn();

		expect(new URL(location).searchParams.get('error')).toBe('account not linked');
		expect(await db.select().from(s.account).where(eq(s.account.userId, 'outsider'))).toEqual([]);
	});

	it('requests the additional scopes and forwards the saved token to the warehouse', async () => {
		await db
			.update(s.ssoProvider)
			.set({ oidcConfig: JSON.stringify({ ...OIDC_CONFIG, scopes: [...OIDC_CONFIG.scopes, 'offline_access'] }) });
		await db
			.insert(s.project)
			.values({ id: 'project-acme', name: 'Acme', type: 'local', path: '/tmp', orgId: ORG_ID });

		const { url } = await startSignIn({ email: 'jane@acme.com' });
		await completeSignIn();

		expect(new URL(url).searchParams.get('scope')).toBe('openid profile email offline_access');
		const user = await findUser('jane@acme.com');
		const [account] = await db.select().from(s.account).where(eq(s.account.userId, user!.id));
		expect(account.refreshToken).toBe('okta-refresh-token');
		await expect(getWarehouseAccessTokenForUser(user!.id, 'project-acme')).resolves.toBe('okta-access-token');
	});

	it.each(['/sso/register', '/sso/update-provider', '/sso/delete-provider', '/sso/verify-domain'])(
		'disables the plugin provider management endpoint %s',
		async (path) => {
			const response = await callAuth(path, {});

			expect(response.status).toBe(404);
		},
	);
});

async function seedOrganizationWithProvider(): Promise<void> {
	await db.insert(s.organization).values({ id: ORG_ID, name: 'Acme', slug: 'acme' });
	await ssoProviderQueries.upsertSsoProvider({
		organizationId: ORG_ID,
		providerId: PROVIDER_ID,
		issuer: OKTA,
		domain: 'acme.com',
		domainVerified: true,
		oidcConfig: JSON.stringify(OIDC_CONFIG),
	});
}

async function startSignIn(body: Record<string, unknown>): Promise<{ url: string; cookie: string }> {
	const response = await callAuth('/sign-in/sso', { callbackURL: '/', ...body });
	const { url } = (await response.json()) as { url: string };
	const cookie = response.headers
		.getSetCookie()
		.map((header) => header.split(';')[0])
		.join('; ');
	return { url, cookie };
}

/** Plays the IdP's redirect back to nao and returns where nao sends the browser next. */
async function completeSignIn(): Promise<string> {
	const { url, cookie } = await startSignIn({ email: 'jane@acme.com' });
	const state = new URL(url).searchParams.get('state') ?? '';
	const auth = await getAuth();
	const callbackUrl = `${BASE_URL}/api/auth/sso/callback/${PROVIDER_ID}?code=okta-code&state=${state}`;
	const response = await auth.handler(new Request(callbackUrl, { headers: { cookie, ...uniqueClientIp() } }));
	return response.headers.get('location') ?? '';
}

async function callAuth(path: string, body: Record<string, unknown>): Promise<Response> {
	const auth = await getAuth();
	return auth.handler(
		new Request(`${BASE_URL}/api/auth${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...uniqueClientIp() },
			body: JSON.stringify(body),
		}),
	);
}

/** Cloud rate-limits sign-ins per client IP; each request gets its own so cases never throttle each other. */
function uniqueClientIp(): Record<string, string> {
	requestCount += 1;
	return { 'x-forwarded-for': `10.0.${Math.floor(requestCount / 250)}.${requestCount % 250}` };
}

function stubOktaFetch(getProfile: () => Record<string, unknown>): typeof fetch {
	return async (input) => {
		const url = input instanceof Request ? input.url : String(input);
		if (url.startsWith(TOKEN_ENDPOINT)) {
			return Response.json({
				access_token: 'okta-access-token',
				refresh_token: 'okta-refresh-token',
				token_type: 'Bearer',
				expires_in: 3600,
			});
		}
		if (url.startsWith(USERINFO_ENDPOINT)) {
			return Response.json(getProfile());
		}
		throw new Error(`Unexpected fetch to ${url}`);
	};
}

async function findUser(email: string) {
	const [user] = await db.select().from(s.user).where(eq(s.user.email, email));
	return user ?? null;
}

async function listMembershipOrgIds(userId: string): Promise<string[]> {
	const memberships = await db.select().from(s.orgMember).where(eq(s.orgMember.userId, userId));
	return memberships.map((membership) => membership.orgId);
}

async function clearData(): Promise<void> {
	await db.delete(s.session);
	await db.delete(s.account);
	await db.delete(s.verification);
	await db.delete(s.ssoProvider);
	await db.delete(s.project);
	await db.delete(s.orgMember);
	await db.delete(s.organization);
	await db.delete(s.user);
}

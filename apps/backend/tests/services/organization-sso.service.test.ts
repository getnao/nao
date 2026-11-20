/* @license Enterprise */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ discoverOIDCConfig: vi.fn(), hasFeature: vi.fn(), lookup: vi.fn() }));

vi.mock('dns/promises', () => ({ default: { lookup: mocks.lookup } }));

vi.mock('@better-auth/sso', async (importOriginal) => ({
	...(await importOriginal<typeof import('@better-auth/sso')>()),
	discoverOIDCConfig: mocks.discoverOIDCConfig,
}));
vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});
vi.mock('../../src/services/license.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/license.service')>()),
	hasFeature: mocks.hasFeature,
}));
vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

import { DiscoveryError } from '@better-auth/sso';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import * as ssoProviderQueries from '../../src/queries/sso-provider.queries';
import {
	activateOrganizationSso,
	configureOrganizationSso,
	deactivateOrganizationSso,
} from '../../src/services/organization-sso.service';

const ORG_ID = 'org-acme';
const OKTA = {
	issuer: 'https://acme.okta.com',
	clientId: 'okta-client',
	clientSecret: 'okta-secret',
	additionalScopes: [],
};

describe('organization SSO configured by an organization admin', () => {
	beforeEach(async () => {
		mocks.hasFeature.mockReset().mockResolvedValue(true);
		mocks.lookup.mockReset().mockResolvedValue([{ address: '93.184.216.34' }]);
		mocks.discoverOIDCConfig.mockReset().mockImplementation(async ({ issuer }: { issuer: string }) => ({
			issuer,
			discoveryEndpoint: `${issuer}/.well-known/openid-configuration`,
			authorizationEndpoint: `${issuer}/oauth2/v1/authorize`,
			tokenEndpoint: `${issuer}/oauth2/v1/token`,
			jwksEndpoint: `${issuer}/oauth2/v1/keys`,
			userInfoEndpoint: `${issuer}/oauth2/v1/userinfo`,
			tokenEndpointAuthentication: 'client_secret_basic',
		}));
		await clearData();
		await db.insert(s.organization).values({ id: ORG_ID, name: 'Acme', slug: 'acme' });
	});

	afterAll(clearData);

	it('refuses to connect an IdP before nao staff activate SSO', async () => {
		await expect(configureOrganizationSso(ORG_ID, OKTA)).rejects.toMatchObject({ codeMessage: 'FORBIDDEN' });
	});

	it('connects the IdP on the domains set by nao staff, and keeps the secret when it is left out', async () => {
		await activateOrganizationSso(ORG_ID, ['acme.com']);

		const configured = await configureOrganizationSso(ORG_ID, OKTA);
		const { clientSecret: _clientSecret, ...withoutSecret } = OKTA;
		const rotated = await configureOrganizationSso(ORG_ID, { ...withoutSecret, clientId: 'rotated' });

		expect(configured).toMatchObject({ issuer: OKTA.issuer, domains: ['acme.com'], hasClientSecret: true });
		expect(JSON.stringify(configured)).not.toContain(OKTA.clientSecret);
		expect(rotated).toMatchObject({ clientId: 'rotated', domains: ['acme.com'] });
		const provider = await ssoProviderQueries.getSsoProviderByOrganizationId(ORG_ID);
		expect(JSON.parse(provider?.oidcConfig ?? '{}')).toMatchObject({
			clientId: 'rotated',
			clientSecret: OKTA.clientSecret,
			tokenEndpoint: `${OKTA.issuer}/oauth2/v1/token`,
		});
	});

	it('requests the additional scopes on top of the sign-in ones', async () => {
		await activateOrganizationSso(ORG_ID, ['acme.com']);

		const configured = await configureOrganizationSso(ORG_ID, {
			...OKTA,
			additionalScopes: ['offline_access', 'session:role-any', 'email'],
		});

		expect(configured.additionalScopes).toEqual(['offline_access', 'session:role-any']);
		const provider = await ssoProviderQueries.getSsoProviderByOrganizationId(ORG_ID);
		expect(JSON.parse(provider?.oidcConfig ?? '{}').scopes).toEqual([
			'openid',
			'profile',
			'email',
			'offline_access',
			'session:role-any',
		]);
	});

	it('keeps what nao staff change while the IdP is being discovered', async () => {
		await activateOrganizationSso(ORG_ID, ['acme.com', 'acme.io']);
		holdDiscoveryWhile(() => activateOrganizationSso(ORG_ID, ['acme.io']));

		const configured = await configureOrganizationSso(ORG_ID, OKTA);

		expect(configured).toMatchObject({ issuer: OKTA.issuer, domains: ['acme.io'] });
	});

	it('refuses to recreate SSO that nao staff deactivated while the IdP was being discovered', async () => {
		await activateOrganizationSso(ORG_ID, ['acme.com']);
		holdDiscoveryWhile(() => deactivateOrganizationSso(ORG_ID));

		await expect(configureOrganizationSso(ORG_ID, OKTA)).rejects.toMatchObject({ codeMessage: 'FORBIDDEN' });
		expect(await ssoProviderQueries.getSsoProviderByOrganizationId(ORG_ID)).toBeNull();
	});

	it.each([
		{
			name: 'an issuer that cannot be discovered',
			input: OKTA,
			setup: () =>
				mocks.discoverOIDCConfig.mockRejectedValueOnce(
					new DiscoveryError('discovery_not_found', 'Discovery endpoint not found'),
				),
			error: 'OIDC discovery failed: Discovery endpoint not found',
		},
		{
			name: 'an issuer on a loopback address',
			input: { ...OKTA, issuer: 'https://127.0.0.1:8443' },
			setup: () => undefined,
			error: 'OIDC discovery failed: Access to private address "127.0.0.1" is not allowed.',
		},
		{
			name: 'an issuer whose name resolves inside the network',
			input: OKTA,
			setup: () => mocks.lookup.mockResolvedValue([{ address: '10.0.0.5' }]),
			error: 'OIDC discovery failed: Hostname "acme.okta.com" resolves to a private IP address, which is not allowed.',
		},
		{
			name: 'a discovery URL on the cloud metadata address',
			input: { ...OKTA, discoveryUrl: 'https://169.254.169.254/.well-known/openid-configuration' },
			setup: () => undefined,
			error: 'OIDC discovery failed: Access to private address "169.254.169.254" is not allowed.',
		},
		{
			name: 'a first setup without a client secret',
			input: { issuer: OKTA.issuer, clientId: OKTA.clientId },
			setup: () => undefined,
			error: 'A client secret is required.',
		},
	])('refuses $name', async ({ input, setup, error }) => {
		await activateOrganizationSso(ORG_ID, ['acme.com']);
		setup();

		await expect(configureOrganizationSso(ORG_ID, input)).rejects.toMatchObject({ message: error });
		expect((await ssoProviderQueries.getSsoProviderByOrganizationId(ORG_ID))?.oidcConfig).toBeNull();
	});

	it.each([
		{ endpoint: 'https://acme.okta.com/oauth2/v1/token', isTrusted: true },
		{ endpoint: 'https://10.0.0.5/oauth2/v1/token', isTrusted: false },
		{ endpoint: 'https://metadata.google.internal/token', isTrusted: false },
		{ endpoint: 'http://acme.okta.com/oauth2/v1/token', isTrusted: false },
	])('trusts the endpoint $endpoint of a discovery document: $isTrusted', async ({ endpoint, isTrusted }) => {
		await activateOrganizationSso(ORG_ID, ['acme.com']);

		await configureOrganizationSso(ORG_ID, OKTA);

		const [{ isTrustedOrigin }] = mocks.discoverOIDCConfig.mock.lastCall as [
			{ isTrustedOrigin: (url: string) => boolean },
		];
		expect(isTrustedOrigin(endpoint)).toBe(isTrusted);
	});
});

/** Runs a staff change while discovery is in flight, then lets discovery answer as usual. */
function holdDiscoveryWhile(staffChange: () => Promise<unknown>): void {
	const discover = mocks.discoverOIDCConfig.getMockImplementation();
	mocks.discoverOIDCConfig.mockImplementationOnce(async (options: { issuer: string }) => {
		await staffChange();
		return discover?.(options);
	});
}

async function clearData(): Promise<void> {
	await db.delete(s.ssoProvider);
	await db.delete(s.organization);
}

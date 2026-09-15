import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	getIdToken: vi.fn(),
	fetch: vi.fn(),
}));

vi.mock('../src/env', () => ({ env: mocks.env }));
vi.mock('../src/queries/account.queries', () => ({
	getIdToken: mocks.getIdToken,
}));

import {
	decodeIdTokenClaims,
	readDecodedIdTokenClaims,
	readVerifiedOidcIdTokenClaims,
	verifyMicrosoftIdTokenClaims,
} from '../src/services/sso-token.service';

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
let fixtureId = 0;

beforeAll(async () => {
	const keys = await generateKeyPair('RS256');
	privateKey = keys.privateKey;
	publicJwk = await exportJWK(keys.publicKey);
	Object.assign(publicJwk, { alg: 'RS256', kid: 'test-key', use: 'sig' });
});

beforeEach(() => {
	for (const key of Object.keys(mocks.env)) {
		delete mocks.env[key];
	}
	mocks.getIdToken.mockReset();
	mocks.fetch.mockReset();
	vi.stubGlobal('fetch', mocks.fetch);
});

describe('generic OIDC ID token verification', () => {
	it('accepts only a signed token with the discovered issuer and configured audience', async () => {
		const fixture = configureOidc();
		mocks.getIdToken.mockResolvedValue(await signToken(fixture.issuer, 'client-id', { groups: ['finance'] }));

		await expect(readVerifiedOidcIdTokenClaims('user-1')).resolves.toMatchObject({
			status: 'verified',
			claims: { groups: ['finance'] },
		});
		expect(mocks.getIdToken).toHaveBeenCalledWith('user-1', 'okta');
	});

	it.each([
		['issuer', 'https://attacker.example', 'client-id'],
		['audience', null, 'another-client'],
	])('rejects a token with the wrong %s', async (_problem, issuerOverride, audience) => {
		const fixture = configureOidc();
		mocks.getIdToken.mockResolvedValue(
			await signToken(issuerOverride ?? fixture.issuer, audience, { groups: ['admins'] }),
		);

		await expect(readVerifiedOidcIdTokenClaims('user-1')).resolves.toEqual({ status: 'invalid' });
	});

	it('rejects a token signed by an unknown key', async () => {
		const fixture = configureOidc();
		const attackerKeys = await generateKeyPair('RS256');
		const token = await new SignJWT({ groups: ['admins'] })
			.setProtectedHeader({ alg: 'RS256', kid: 'attacker-key' })
			.setIssuer(fixture.issuer)
			.setAudience('client-id')
			.setExpirationTime('5m')
			.sign(attackerKeys.privateKey);
		mocks.getIdToken.mockResolvedValue(token);

		await expect(readVerifiedOidcIdTokenClaims('user-1')).resolves.toEqual({ status: 'invalid' });
	});

	it('distinguishes an unavailable discovery endpoint from an invalid token', async () => {
		const fixture = configureOidc();
		mocks.fetch.mockRejectedValue(new Error('provider unavailable'));
		mocks.getIdToken.mockResolvedValue(await signToken(fixture.issuer, 'client-id', {}));

		await expect(readVerifiedOidcIdTokenClaims('user-1')).resolves.toEqual({ status: 'unavailable' });

		mocks.getIdToken.mockResolvedValue('not-a-jwt');
		await expect(readVerifiedOidcIdTokenClaims('user-1')).resolves.toEqual({ status: 'invalid' });
	});

	it('reports an unavailable JWKS endpoint separately from an invalid token', async () => {
		const fixture = configureOidc();
		mocks.fetch.mockImplementation(async (input: string | URL | Request) => {
			const url = requestUrl(input);
			if (url === fixture.discoveryUrl) {
				return jsonResponse({ issuer: fixture.issuer, jwks_uri: fixture.jwksUri });
			}
			throw new TypeError('JWKS unavailable');
		});
		mocks.getIdToken.mockResolvedValue(await signToken(fixture.issuer, 'client-id', {}));

		await expect(readVerifiedOidcIdTokenClaims('user-1')).resolves.toEqual({ status: 'unavailable' });
	});
});

describe('Microsoft ID token verification', () => {
	it('verifies the tenant issuer, signature, and client audience', async () => {
		const tenantId = `tenant-${++fixtureId}`;
		const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
		const jwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
		Object.assign(mocks.env, {
			AZURE_AD_CLIENT_ID: 'microsoft-client',
			AZURE_AD_TENANT_ID: tenantId,
		});
		mockDiscovery(`${issuer}/.well-known/openid-configuration`, issuer, jwksUri);
		const token = await signToken(issuer, 'microsoft-client', { groups: ['group-id'] });

		await expect(verifyMicrosoftIdTokenClaims(token)).resolves.toMatchObject({
			status: 'verified',
			claims: { groups: ['group-id'] },
		});
	});

	it('rejects discovery metadata that changes the configured tenant issuer', async () => {
		const tenantId = `tenant-${++fixtureId}`;
		const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
		Object.assign(mocks.env, {
			AZURE_AD_CLIENT_ID: 'microsoft-client',
			AZURE_AD_TENANT_ID: tenantId,
		});
		mockDiscovery(
			`${issuer}/.well-known/openid-configuration`,
			'https://login.microsoftonline.com/another-tenant/v2.0',
			`${issuer}/keys`,
		);

		await expect(verifyMicrosoftIdTokenClaims(await signToken(issuer, 'microsoft-client', {}))).resolves.toEqual({
			status: 'invalid',
		});
	});
});

describe('ID token inspection', () => {
	it('keeps decode-only inspection available without provider metadata', async () => {
		const token = unsignedToken({ groups: ['inspection-only'] });
		mocks.getIdToken.mockResolvedValue(token);

		expect(decodeIdTokenClaims(token)).toEqual({
			status: 'decoded',
			claims: { groups: ['inspection-only'] },
		});
		await expect(readDecodedIdTokenClaims('user-1', 'okta')).resolves.toEqual({
			status: 'decoded',
			claims: { groups: ['inspection-only'] },
		});
		expect(mocks.fetch).not.toHaveBeenCalled();
	});
});

function configureOidc(): { issuer: string; discoveryUrl: string; jwksUri: string } {
	const id = ++fixtureId;
	const issuer = `https://issuer-${id}.example`;
	const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
	const jwksUri = `${issuer}/keys`;
	Object.assign(mocks.env, {
		OIDC_CLIENT_ID: 'client-id',
		OIDC_DISCOVERY_URL: discoveryUrl,
		OIDC_PROVIDER_ID: 'okta',
	});
	mockDiscovery(discoveryUrl, issuer, jwksUri);
	return { issuer, discoveryUrl, jwksUri };
}

function mockDiscovery(discoveryUrl: string, issuer: string, jwksUri: string): void {
	mocks.fetch.mockImplementation(async (input: string | URL | Request) => {
		const url = requestUrl(input);
		if (url === discoveryUrl) {
			return jsonResponse({ issuer, jwks_uri: jwksUri });
		}
		if (url === jwksUri) {
			return jsonResponse({ keys: [publicJwk] });
		}
		throw new Error(`Unexpected URL: ${url}`);
	});
}

function requestUrl(input: string | URL | Request): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function signToken(issuer: string, audience: string, claims: Record<string, unknown>): Promise<string> {
	return new SignJWT(claims)
		.setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
		.setIssuer(issuer)
		.setAudience(audience)
		.setIssuedAt()
		.setExpirationTime('5m')
		.sign(privateKey);
}

function unsignedToken(claims: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
	const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
	return `${header}.${payload}.`;
}

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
}

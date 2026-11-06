import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import {
	isAuthorizationResponse,
	isPublicResourceFlow,
	publicFlowMarkerId,
	reissueJwt,
	reissueTokenResponse,
	rewriteLocationIssuer,
	rewriteRedirectIssuer,
	sameOriginRedirectPath,
} from '../src/mcp/public-issuer';
import { verifyJwtWithLocalJwks } from '../src/mcp/verify-jwt';

const ui = 'https://nao.internal.example/api/auth';
const pub = 'https://nao-mcp.public.example/api/auth';
const publicMcp = 'https://nao-mcp.public.example/mcp';

describe('isPublicResourceFlow', () => {
	it('matches the public resource on the authorize query', () => {
		expect(isPublicResourceFlow({ resource: publicMcp }, publicMcp)).toBe(true);
		expect(isPublicResourceFlow({ resource: ['https://other/mcp', publicMcp] }, publicMcp)).toBe(true);
	});

	it("matches the public resource inside the consent page's oauth_query", () => {
		const oauthQuery = new URLSearchParams({ client_id: 'c', resource: publicMcp, state: 's' }).toString();
		expect(isPublicResourceFlow({ oauthQuery }, publicMcp)).toBe(true);
	});

	it('does not match other resources, no resource, or an unset public URL', () => {
		expect(isPublicResourceFlow({ resource: 'https://nao.internal.example/mcp' }, publicMcp)).toBe(false);
		expect(isPublicResourceFlow({}, publicMcp)).toBe(false);
		expect(isPublicResourceFlow({ resource: publicMcp }, undefined)).toBe(false);
	});
});

describe('publicFlowMarkerId', () => {
	const authorize = new URLSearchParams({
		response_type: 'code',
		client_id: 'client-1',
		redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
		code_challenge: 'challenge-1',
		state: 'state-1',
		resource: publicMcp,
	});

	it('gives the authorize request and its consent page the same key', () => {
		// The consent page gets a signed copy of the query without `resource`.
		const consent = new URLSearchParams(authorize);
		consent.delete('resource');
		consent.set('sig', 'signature');
		consent.set('exp', '1792576110');
		expect(publicFlowMarkerId(consent)).toBe(publicFlowMarkerId(authorize));
		expect(publicFlowMarkerId(authorize)).toBe('mcp-public-flow:client-1:challenge-1');
	});

	it('needs both client_id and a PKCE code_challenge (no state fallback)', () => {
		expect(publicFlowMarkerId(new URLSearchParams({ client_id: 'client-1', state: 'state-1' }))).toBeUndefined();
		expect(publicFlowMarkerId(new URLSearchParams({ code_challenge: 'c' }))).toBeUndefined();
		expect(publicFlowMarkerId(new URLSearchParams({ client_id: 'client-1' }))).toBeUndefined();
	});
});

describe('sameOriginRedirectPath', () => {
	const base = 'https://nao.internal.example/api/auth';

	it('resolves relative and same-origin redirects to their path', () => {
		expect(sameOriginRedirectPath('/consent?client_id=c', base)).toBe('/consent');
		expect(sameOriginRedirectPath('https://nao.internal.example/login?x=1', base)).toBe('/login');
	});

	it('rejects redirects to another origin, even with a matching path', () => {
		expect(sameOriginRedirectPath('https://claude.ai/login?code=x', base)).toBeUndefined();
		expect(sameOriginRedirectPath('https://claude.ai/consent', base)).toBeUndefined();
	});
});

describe('isAuthorizationResponse', () => {
	it('detects code and error responses only', () => {
		expect(isAuthorizationResponse('https://claude.ai/cb?code=abc&state=s')).toBe(true);
		expect(isAuthorizationResponse('https://claude.ai/cb?error=access_denied')).toBe(true);
		expect(isAuthorizationResponse('https://nao.internal.example/consent?client_id=c')).toBe(false);
		expect(isAuthorizationResponse('/consent?client_id=c')).toBe(false);
	});
});

describe('rewriteRedirectIssuer', () => {
	it('swaps the iss of an authorization response and keeps code and state', () => {
		const url = `https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz&iss=${encodeURIComponent(ui)}`;
		const out = new URL(rewriteRedirectIssuer(url, ui, pub));
		expect(out.searchParams.get('iss')).toBe(pub);
		expect(out.searchParams.get('code')).toBe('abc');
		expect(out.searchParams.get('state')).toBe('xyz');
		expect(out.origin + out.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
	});

	it('leaves URLs without that issuer, or invalid URLs, untouched', () => {
		const other = 'https://claude.ai/cb?code=abc&iss=https%3A%2F%2Fidp.example';
		expect(rewriteRedirectIssuer(other, ui, pub)).toBe(other);
		expect(rewriteRedirectIssuer('https://claude.ai/cb?code=abc', ui, pub)).toBe('https://claude.ai/cb?code=abc');
		expect(rewriteRedirectIssuer('not a url', ui, pub)).toBe('not a url');
	});
});

describe('rewriteLocationIssuer', () => {
	it('swaps the iss of a Location header in place', () => {
		const headers = new Headers({
			location: `https://claude.ai/api/mcp/auth_callback?code=abc&iss=${encodeURIComponent(ui)}`,
			'set-cookie': 'session=1',
		});
		rewriteLocationIssuer(headers, ui, pub);
		expect(new URL(headers.get('location') ?? '').searchParams.get('iss')).toBe(pub);
		expect(headers.get('set-cookie')).toBe('session=1');
	});

	it('ignores missing headers and headers without a Location', () => {
		const headers = new Headers({ 'content-type': 'application/json' });
		rewriteLocationIssuer(headers, ui, pub);
		expect(headers.has('location')).toBe(false);
		expect(() => rewriteLocationIssuer(undefined, ui, pub)).not.toThrow();
	});
});

describe('token re-issue', () => {
	let sign: (payload: JWTPayload) => Promise<string>;
	let keys: unknown[];

	beforeAll(async () => {
		const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
		keys = [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'EdDSA' }];
		sign = (payload) => new SignJWT(payload).setProtectedHeader({ alg: 'EdDSA', kid: 'k1' }).sign(privateKey);
	});

	const claims = (iss: string): JWTPayload => ({
		iss,
		sub: 'user-1',
		aud: publicMcp,
		azp: 'client-1',
		scope: 'openid offline_access',
		iat: Math.floor(Date.now() / 1000),
		exp: Math.floor(Date.now() / 1000) + 3600,
	});

	it('re-signs a UI-issued token with the public issuer and keeps every other claim', async () => {
		const originalClaims = { ...claims(ui), jti: 'token-1', custom: { team: 'data' } };
		const original = await sign(originalClaims);
		const reissued = await reissueJwt(original, ui, pub, sign);
		const payload = await verifyJwtWithLocalJwks(reissued, { audience: [publicMcp], issuer: [ui, pub], keys });
		expect(payload).toStrictEqual({ ...originalClaims, iss: pub });
	});

	it('is still rejected by a verifier that only trusts the UI issuer', async () => {
		const reissued = await reissueJwt(await sign(claims(ui)), ui, pub, sign);
		await expect(verifyJwtWithLocalJwks(reissued, { audience: [publicMcp], issuer: ui, keys })).rejects.toThrow();
	});

	it('leaves opaque tokens and tokens from another issuer untouched', async () => {
		expect(await reissueJwt('opaque-refresh-token', ui, pub, sign)).toBe('opaque-refresh-token');
		const foreign = await sign(claims('https://idp.example'));
		expect(await reissueJwt(foreign, ui, pub, sign)).toBe(foreign);
	});

	it('re-issues access_token and id_token in a token response, nothing else', async () => {
		const response = {
			access_token: await sign(claims(ui)),
			id_token: await sign({ ...claims(ui), aud: 'client-1' }),
			refresh_token: 'opaque-refresh-token',
			token_type: 'Bearer',
			expires_in: 3600,
		};
		const out = await reissueTokenResponse(response, ui, pub, sign);
		const access = await verifyJwtWithLocalJwks(out.access_token, { audience: [publicMcp], issuer: pub, keys });
		const id = await verifyJwtWithLocalJwks(out.id_token, { audience: ['client-1'], issuer: pub, keys });
		expect(access.iss).toBe(pub);
		expect(id.iss).toBe(pub);
		expect(out).toMatchObject({ refresh_token: 'opaque-refresh-token', token_type: 'Bearer', expires_in: 3600 });
	});
});

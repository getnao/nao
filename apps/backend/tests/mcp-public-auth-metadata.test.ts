import { describe, expect, it } from 'vitest';

import { rebaseOrigin, rewriteAuthServerMetadataForPublicHost } from '../src/mcp/public-auth-metadata';

const ui = 'https://nao.internal.example';
const pub = 'https://nao-mcp.public.example';

describe('rebaseOrigin', () => {
	it('swaps the origin and keeps path and query', () => {
		expect(rebaseOrigin(`${ui}/api/auth`, pub)).toBe(`${pub}/api/auth`);
		expect(rebaseOrigin(`${ui}/api/auth/oauth2/token?x=1`, pub)).toBe(`${pub}/api/auth/oauth2/token?x=1`);
	});

	it('does not add or drop a trailing slash', () => {
		expect(rebaseOrigin(ui, pub)).toBe(pub);
		expect(rebaseOrigin(`${ui}/`, pub)).toBe(`${pub}/`);
	});
});

describe('rewriteAuthServerMetadataForPublicHost', () => {
	const metadata = {
		issuer: `${ui}/api/auth`,
		authorization_endpoint: `${ui}/api/auth/oauth2/authorize`,
		end_session_endpoint: `${ui}/api/auth/oauth2/end-session`,
		token_endpoint: `${ui}/api/auth/oauth2/token`,
		jwks_uri: `${ui}/api/auth/jwks`,
		registration_endpoint: `${ui}/api/auth/oauth2/register`,
		introspection_endpoint: `${ui}/api/auth/oauth2/introspect`,
		revocation_endpoint: `${ui}/api/auth/oauth2/revoke`,
		userinfo_endpoint: `${ui}/api/auth/oauth2/userinfo`,
		code_challenge_methods_supported: ['S256'],
		scopes_supported: ['openid', 'offline_access'],
	};

	it('moves the issuer and server-to-server endpoints to the public host', () => {
		const out = rewriteAuthServerMetadataForPublicHost(metadata, { uiOrigin: ui, publicOrigin: pub });
		expect(out.issuer).toBe(`${pub}/api/auth`);
		expect(out.token_endpoint).toBe(`${pub}/api/auth/oauth2/token`);
		expect(out.jwks_uri).toBe(`${pub}/api/auth/jwks`);
		expect(out.registration_endpoint).toBe(`${pub}/api/auth/oauth2/register`);
		expect(out.introspection_endpoint).toBe(`${pub}/api/auth/oauth2/introspect`);
		expect(out.revocation_endpoint).toBe(`${pub}/api/auth/oauth2/revoke`);
		expect(out.userinfo_endpoint).toBe(`${pub}/api/auth/oauth2/userinfo`);
	});

	it('keeps browser endpoints on the UI host', () => {
		const out = rewriteAuthServerMetadataForPublicHost(metadata, { uiOrigin: ui, publicOrigin: pub });
		expect(out.authorization_endpoint).toBe(`${ui}/api/auth/oauth2/authorize`);
		expect(out.end_session_endpoint).toBe(`${ui}/api/auth/oauth2/end-session`);
	});

	it('leaves non-URL fields, other origins and the input untouched', () => {
		const withExternal = {
			...metadata,
			service_documentation: 'https://docs.example/x',
			token_endpoint: 'https://idp.example/token',
		};
		const out = rewriteAuthServerMetadataForPublicHost(withExternal, { uiOrigin: ui, publicOrigin: pub });
		expect(out.token_endpoint).toBe('https://idp.example/token');
		expect(out.service_documentation).toBe('https://docs.example/x');
		expect(out.code_challenge_methods_supported).toEqual(['S256']);
		expect(withExternal.issuer).toBe(`${ui}/api/auth`);
	});
});

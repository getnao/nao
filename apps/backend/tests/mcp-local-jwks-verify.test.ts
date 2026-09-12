import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { verifyJwtWithLocalJwks } from '../src/mcp/verify-jwt';

// Regression test for the split-horizon breakage: nao must verify its own MCP
// access tokens against the in-process JWK set, never by fetching the external
// issuer URL (which is unreachable from the server's own network in a
// VPN-only / private-DNS self-hosted deployment). These cases exercise the
// local-verification helper with no network involved at all.

const ISSUER = 'https://nao.internal.example/api/auth';
const AUDIENCE = 'https://nao-mcp.public.example/mcp';
const KID = 'test-kid';

async function makeKeys() {
	const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
	const publicJwk = await exportJWK(publicKey);
	publicJwk.kid = KID;
	publicJwk.alg = 'EdDSA';
	return { privateKey, keys: [publicJwk] };
}

async function sign(privateKey: CryptoKey, claims: { aud: string | string[]; iss?: string }): Promise<string> {
	return new SignJWT({})
		.setProtectedHeader({ alg: 'EdDSA', kid: KID })
		.setSubject('user-123')
		.setIssuer(claims.iss ?? ISSUER)
		.setAudience(claims.aud)
		.setIssuedAt()
		.setExpirationTime('5m')
		.sign(privateKey);
}

describe('verifyJwtWithLocalJwks', () => {
	it('verifies a token against the local JWK set (no network fetch)', async () => {
		const { privateKey, keys } = await makeKeys();
		const token = await sign(privateKey, { aud: AUDIENCE });
		const payload = await verifyJwtWithLocalJwks(token, { audience: [AUDIENCE], issuer: ISSUER, keys });
		expect(payload.sub).toBe('user-123');
		expect(payload.aud).toContain(AUDIENCE);
	});

	it('accepts a token whose aud matches any of the allowed audiences', async () => {
		const { privateKey, keys } = await makeKeys();
		const token = await sign(privateKey, {
			aud: [AUDIENCE, 'https://nao.internal.example/api/auth/oauth2/userinfo'],
		});
		const payload = await verifyJwtWithLocalJwks(token, {
			audience: ['https://nao.internal.example/mcp', AUDIENCE],
			issuer: ISSUER,
			keys,
		});
		expect(payload.sub).toBe('user-123');
	});

	it('rejects a token minted for a different audience', async () => {
		const { privateKey, keys } = await makeKeys();
		const token = await sign(privateKey, { aud: 'https://someone-else.example/mcp' });
		await expect(verifyJwtWithLocalJwks(token, { audience: [AUDIENCE], issuer: ISSUER, keys })).rejects.toThrow();
	});

	it('rejects a token from a different issuer', async () => {
		const { privateKey, keys } = await makeKeys();
		const token = await sign(privateKey, { aud: AUDIENCE, iss: 'https://evil.example/api/auth' });
		await expect(verifyJwtWithLocalJwks(token, { audience: [AUDIENCE], issuer: ISSUER, keys })).rejects.toThrow();
	});

	it('rejects a token signed by a key outside the set', async () => {
		const { keys } = await makeKeys();
		const other = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
		const token = await sign(other.privateKey, { aud: AUDIENCE });
		await expect(verifyJwtWithLocalJwks(token, { audience: [AUDIENCE], issuer: ISSUER, keys })).rejects.toThrow();
	});
});

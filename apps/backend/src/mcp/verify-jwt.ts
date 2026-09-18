import { createLocalJWKSet, type JSONWebKeySet, type JWTPayload, jwtVerify } from 'jose';

/**
 * Verify an OAuth access token (JWT) against an in-process JWK set — no network
 * round-trip.
 *
 * nao is the token issuer, so it already holds its own signing keys. Fetching
 * them over the external issuer URL (BETTER_AUTH_URL/jwks), as better-auth's
 * `verifyAccessToken` does, breaks self-hosted split-horizon deployments where
 * that host is not resolvable from the server's own network: the fetch throws,
 * better-auth swallows it, and every MCP token is rejected with "no token
 * payload". Passing the local key set to jose avoids the self-referential fetch
 * entirely.
 *
 * `keys` is the `keys` array returned by better-auth's `auth.api.getJwks()`
 * (kept as `unknown` to avoid coupling to its exact JWK type).
 */
export async function verifyJwtWithLocalJwks(
	token: string,
	{ audience, issuer, keys }: { audience: string[]; issuer: string; keys: unknown },
): Promise<JWTPayload> {
	const keySet = createLocalJWKSet({ keys } as unknown as JSONWebKeySet);
	const { payload } = await jwtVerify(token, keySet, { audience, issuer });
	return payload;
}

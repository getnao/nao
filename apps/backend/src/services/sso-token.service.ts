/* @license Enterprise */

import { createRemoteJWKSet, decodeJwt, errors, jwtVerify, type JWTVerifyOptions } from 'jose';

import { env } from '../env';
import * as accountQueries from '../queries/account.queries';

export type DecodedIdTokenClaims =
	| { status: 'no-token' }
	| { status: 'undecodable' }
	| { status: 'decoded'; claims: Record<string, unknown> };

export type VerifiedIdTokenClaims =
	| { status: 'no-token' }
	| { status: 'invalid' }
	| { status: 'unavailable' }
	| { status: 'verified'; claims: Record<string, unknown> };

interface OidcDiscoveryMetadata {
	issuer: string;
	jwksUri: string;
}

const DISCOVERY_TIMEOUT_MS = 10_000;
const DISCOVERY_CACHE_TTL_MS = 5 * 60_000;
const discoveryCache = new Map<string, { expiresAt: number; request: Promise<OidcDiscoveryMetadata> }>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function readVerifiedOidcIdTokenClaims(userId: string): Promise<VerifiedIdTokenClaims> {
	const idToken = await accountQueries.getIdToken(userId, env.OIDC_PROVIDER_ID ?? 'oidc');
	if (!env.OIDC_DISCOVERY_URL || !env.OIDC_CLIENT_ID) {
		return idToken ? { status: 'unavailable' } : { status: 'no-token' };
	}
	return verifyIdTokenClaims(idToken, env.OIDC_DISCOVERY_URL, {
		audience: env.OIDC_CLIENT_ID,
	});
}

export async function verifyMicrosoftIdTokenClaims(idToken: string | null): Promise<VerifiedIdTokenClaims> {
	const { AZURE_AD_CLIENT_ID: clientId, AZURE_AD_TENANT_ID: tenantId } = env;
	if (!clientId || !tenantId) {
		return idToken ? { status: 'unavailable' } : { status: 'no-token' };
	}

	const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
	const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
	return verifyIdTokenClaims(idToken, discoveryUrl, { audience: clientId, issuer });
}

export async function readDecodedIdTokenClaims(userId: string, providerId: string): Promise<DecodedIdTokenClaims> {
	return decodeIdTokenClaims(await accountQueries.getIdToken(userId, providerId));
}

export function decodeIdTokenClaims(idToken: string | null): DecodedIdTokenClaims {
	if (!idToken) {
		return { status: 'no-token' };
	}

	try {
		return { status: 'decoded', claims: decodeJwt(idToken) };
	} catch {
		return { status: 'undecodable' };
	}
}

async function verifyIdTokenClaims(
	idToken: string | null,
	discoveryUrl: string,
	options: JWTVerifyOptions,
): Promise<VerifiedIdTokenClaims> {
	if (!idToken) {
		return { status: 'no-token' };
	}
	if (decodeIdTokenClaims(idToken).status === 'undecodable') {
		return { status: 'invalid' };
	}

	let metadata: OidcDiscoveryMetadata;
	try {
		metadata = await getDiscoveryMetadata(discoveryUrl);
	} catch {
		return { status: 'unavailable' };
	}
	if (options.issuer && metadata.issuer !== options.issuer) {
		return { status: 'invalid' };
	}

	try {
		const { payload } = await jwtVerify(idToken, getRemoteJwks(metadata.jwksUri), {
			...options,
			issuer: options.issuer ?? metadata.issuer,
		});
		if (!Number.isFinite(payload.exp) || !Number.isFinite(payload.iat)) {
			return { status: 'invalid' };
		}
		return { status: 'verified', claims: payload };
	} catch (error) {
		return { status: isVerificationUnavailable(error) ? 'unavailable' : 'invalid' };
	}
}

async function getDiscoveryMetadata(discoveryUrl: string): Promise<OidcDiscoveryMetadata> {
	const cached = discoveryCache.get(discoveryUrl);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.request;
	}

	const request = fetchDiscoveryMetadata(discoveryUrl).catch((error) => {
		if (discoveryCache.get(discoveryUrl)?.request === request) {
			discoveryCache.delete(discoveryUrl);
		}
		throw error;
	});
	discoveryCache.set(discoveryUrl, {
		expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
		request,
	});
	return request;
}

async function fetchDiscoveryMetadata(discoveryUrl: string): Promise<OidcDiscoveryMetadata> {
	const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
	if (!response.ok) {
		throw new Error(`OIDC discovery failed with status ${response.status}`);
	}

	const metadata: unknown = await response.json();
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
		throw new Error('OIDC discovery returned malformed metadata');
	}
	const { issuer, jwks_uri: jwksUri } = metadata as Record<string, unknown>;
	if (typeof issuer !== 'string' || typeof jwksUri !== 'string') {
		throw new Error('OIDC discovery metadata is missing issuer or jwks_uri');
	}
	new URL(issuer);
	new URL(jwksUri);
	return { issuer, jwksUri };
}

function getRemoteJwks(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
	const cached = jwksCache.get(jwksUri);
	if (cached) {
		return cached;
	}
	const jwks = createRemoteJWKSet(new URL(jwksUri));
	jwksCache.set(jwksUri, jwks);
	return jwks;
}

function isVerificationUnavailable(error: unknown): boolean {
	if (error instanceof errors.JWKSTimeout || error instanceof TypeError) {
		return true;
	}
	return (
		error instanceof errors.JOSEError &&
		error.code === 'ERR_JOSE_GENERIC' &&
		(error.message.includes('Expected 200 OK') || error.message.includes('fetch'))
	);
}

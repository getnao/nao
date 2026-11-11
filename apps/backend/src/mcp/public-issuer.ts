import { decodeJwt, type JWTPayload } from 'jose';

/**
 * Per-flow issuer for the public MCP host (MCP_PUBLIC_URL).
 *
 * Discovery on the public host advertises `<MCP_PUBLIC_URL>/api/auth` as the issuer
 * (see public-auth-metadata.ts), but better-auth stamps `BETTER_AUTH_URL` into the
 * authorization response `iss` (RFC 9207) and into the tokens it signs. Clients that
 * compare those with the discovered issuer (claude.ai does) abort after consent. For
 * flows that target the public MCP resource, these helpers swap in the public issuer.
 */

function asList(value: unknown): string[] {
	if (typeof value === 'string') {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.filter((v): v is string => typeof v === 'string');
	}
	return [];
}

/**
 * Whether an authorization request targets the public MCP resource: `resource` from the
 * request query, or from the consent page's `oauth_query` (the original authorize query).
 */
export function isPublicResourceFlow(
	{ resource, oauthQuery }: { resource?: unknown; oauthQuery?: unknown },
	publicServerUrl: string | undefined,
): boolean {
	if (!publicServerUrl) {
		return false;
	}
	const resources = asList(resource);
	if (typeof oauthQuery === 'string') {
		resources.push(...new URLSearchParams(oauthQuery).getAll('resource'));
	}
	return resources.includes(publicServerUrl);
}

const FLOW_MARKER_PREFIX = 'mcp-public-flow:';

/**
 * Key that ties an authorization request to its consent step. better-auth drops `resource`
 * from the signed query it hands the consent page, so the authorize step records public-MCP
 * flows under this key: the PKCE `code_challenge` (mandatory for these clients), scoped by
 * `client_id`.
 */
export function publicFlowMarkerId(params: URLSearchParams): string | undefined {
	const clientId = params.get('client_id');
	const codeChallenge = params.get('code_challenge');
	return clientId && codeChallenge ? `${FLOW_MARKER_PREFIX}${clientId}:${codeChallenge}` : undefined;
}

/**
 * Path of a redirect target on `base`'s origin (relative Locations included), or undefined
 * when it points anywhere else.
 */
export function sameOriginRedirectPath(url: string, base: string): string | undefined {
	try {
		const target = new URL(url, base);
		return target.origin === new URL(base).origin ? target.pathname : undefined;
	} catch {
		return undefined;
	}
}

/** Whether a redirect URL is an authorization response (carries `code` or `error`). */
export function isAuthorizationResponse(url: string): boolean {
	try {
		const { searchParams } = new URL(url);
		return searchParams.has('code') || searchParams.has('error');
	} catch {
		return false;
	}
}

/** Replace the RFC 9207 `iss` of a redirect URL when it carries `fromIssuer`. */
export function rewriteRedirectIssuer(url: string, fromIssuer: string, toIssuer: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}
	if (parsed.searchParams.get('iss') !== fromIssuer) {
		return url;
	}
	parsed.searchParams.set('iss', toIssuer);
	return parsed.toString();
}

/** Apply `rewriteRedirectIssuer` to a `Location` header, in place. */
export function rewriteLocationIssuer(headers: Headers | undefined, fromIssuer: string, toIssuer: string): void {
	const location = headers?.get('location');
	if (headers && location) {
		headers.set('location', rewriteRedirectIssuer(location, fromIssuer, toIssuer));
	}
}

type Sign = (payload: JWTPayload) => Promise<string>;

/** Re-sign a JWT whose `iss` is `fromIssuer` with `toIssuer`; anything else is returned as is. */
export async function reissueJwt(token: string, fromIssuer: string, toIssuer: string, sign: Sign): Promise<string> {
	let payload: JWTPayload;
	try {
		payload = decodeJwt(token);
	} catch {
		return token; // opaque token
	}
	if (payload.iss !== fromIssuer) {
		return token;
	}
	return sign({ ...payload, iss: toIssuer });
}

/** Re-issue the JWTs in an OAuth token response (`access_token`, `id_token`) with `toIssuer`. */
export async function reissueTokenResponse<T extends Record<string, unknown>>(
	body: T,
	fromIssuer: string,
	toIssuer: string,
	sign: Sign,
): Promise<T> {
	const out: Record<string, unknown> = { ...body };
	for (const key of ['access_token', 'id_token']) {
		const token = body[key];
		if (typeof token === 'string') {
			out[key] = await reissueJwt(token, fromIssuer, toIssuer, sign);
		}
	}
	return out as T;
}

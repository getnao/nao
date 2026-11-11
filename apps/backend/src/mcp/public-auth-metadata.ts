/**
 * Rebase OAuth discovery documents onto the public MCP host (MCP_PUBLIC_URL).
 *
 * With a split deployment (UI on a private host, MCP on a public one), better-auth
 * advertises every endpoint on BETTER_AUTH_URL. A remote MCP client that relies on
 * discovery (RFC 9728 → RFC 8414) then calls the token/JWKS endpoints on a host it
 * cannot reach, and the connection hangs. For requests that arrive on the public
 * host we advertise that host as the authorization server and rebase the endpoints
 * the client's *server* calls. The endpoints the user's *browser* opens stay on the
 * UI host, where sign-in happens.
 */

/** Endpoints opened in the user's browser: they stay on the UI host. */
const BROWSER_ENDPOINT_KEYS = new Set(['authorization_endpoint', 'end_session_endpoint']);

/** Replace `url`'s origin with `origin`, keeping path, query and fragment. */
export function rebaseOrigin(url: string, origin: string): string {
	const target = new URL(origin);
	const rebased = new URL(url);
	rebased.protocol = target.protocol;
	rebased.host = target.host;
	return rebased.toString().replace(/\/$/, url.endsWith('/') ? '/' : '');
}

function isEndpointKey(key: string): boolean {
	return key.endsWith('_endpoint') || key === 'jwks_uri';
}

/**
 * Rewrite RFC 8414 / OpenID discovery metadata for the public MCP host: `issuer` and
 * every server-to-server endpoint on the UI origin move to `publicOrigin`; browser
 * endpoints and URLs on any other origin are left untouched.
 */
export function rewriteAuthServerMetadataForPublicHost(
	metadata: Record<string, unknown>,
	{ uiOrigin, publicOrigin }: { uiOrigin: string; publicOrigin: string },
): Record<string, unknown> {
	const ui = new URL(uiOrigin).origin;
	const onUiOrigin = (value: unknown): value is string => {
		if (typeof value !== 'string') {
			return false;
		}
		try {
			return new URL(value).origin === ui;
		} catch {
			return false;
		}
	};

	const rewritten: Record<string, unknown> = { ...metadata };
	for (const [key, value] of Object.entries(metadata)) {
		const rebase = key === 'issuer' || (isEndpointKey(key) && !BROWSER_ENDPOINT_KEYS.has(key));
		if (rebase && onUiOrigin(value)) {
			rewritten[key] = rebaseOrigin(value, publicOrigin);
		}
	}
	return rewritten;
}

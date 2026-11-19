/**
 * Keep OAuth token responses portable when a provider returns both the standard
 * relative lifetime and a redundant absolute-expiry extension.
 */
export function omitRedundantTokenExpiry(response: unknown): unknown {
	if (!response || typeof response !== 'object') {
		return response;
	}
	const tokenResponse = response as Record<string, unknown>;
	if (
		!('access_token' in tokenResponse) ||
		typeof tokenResponse.expires_at !== 'number' ||
		typeof tokenResponse.expires_in !== 'number'
	) {
		return response;
	}
	const { expires_at: _, ...portableResponse } = tokenResponse;
	return portableResponse;
}

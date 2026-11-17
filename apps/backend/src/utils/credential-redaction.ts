/** Matches credentials embedded in a URL, e.g. `https://oauth2:TOKEN@host/...` (git clone/push errors). */
const CREDENTIALED_URL_PATTERN = /:\/\/[^/\s@]+@/g;

export function redactCredentialedUrls(value: string): string {
	return value.replace(CREDENTIALED_URL_PATTERN, '://***@');
}

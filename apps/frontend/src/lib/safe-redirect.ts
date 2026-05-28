const AUTH_PATHS = new Set(['/login', '/signup', '/forgot-password', '/reset-password']);

/**
 * Returns a redirect target only when it is a safe in-app path. Rejects
 * external URLs, protocol-relative paths, and the auth pages themselves to
 * avoid redirect loops.
 */
export function getSafeRedirectPath(value: string | undefined | null): string | null {
	if (!value) {
		return null;
	}
	if (!value.startsWith('/')) {
		return null;
	}
	if (value.startsWith('//') || value.startsWith('/\\')) {
		return null;
	}
	const pathname = value.split(/[?#]/, 1)[0];
	const normalized = pathname.toLowerCase().replace(/\/+$/, '') || '/';
	if (AUTH_PATHS.has(normalized)) {
		return null;
	}
	return value;
}

export const SIGN_IN_METHODS = ['email', 'google', 'github', 'gitlab', 'microsoft', 'oidc'] as const;

export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

const LAST_SIGN_IN_METHOD_STORAGE_KEY = 'nao:last-sign-in-method';

export function rememberSignInMethod(method: SignInMethod): void {
	try {
		localStorage.setItem(LAST_SIGN_IN_METHOD_STORAGE_KEY, method);
	} catch {
		/* localStorage unavailable */
	}
}

export function loadLastSignInMethod(): SignInMethod | null {
	try {
		const stored = localStorage.getItem(LAST_SIGN_IN_METHOD_STORAGE_KEY);
		return SIGN_IN_METHODS.includes(stored as SignInMethod) ? (stored as SignInMethod) : null;
	} catch {
		/* localStorage unavailable */
	}
	return null;
}

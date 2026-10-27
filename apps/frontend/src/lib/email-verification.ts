import { getSafeRedirectPath } from './safe-redirect';

interface AuthError {
	code?: string;
	message?: string;
}

export function buildEmailVerificationCallbackUrl(redirect: string | null | undefined): string {
	const safeRedirect = getSafeRedirectPath(redirect);
	if (!safeRedirect) {
		return '/email-verified';
	}
	return `/email-verified?${new URLSearchParams({ redirect: safeRedirect }).toString()}`;
}

export function isEmailNotVerifiedError(error: AuthError): boolean {
	return error.code?.toUpperCase() === 'EMAIL_NOT_VERIFIED';
}

export function getEmailVerificationErrorMessage(error: string | undefined): string | undefined {
	switch (error?.toUpperCase()) {
		case 'TOKEN_EXPIRED':
			return 'This verification link has expired. Log in again to receive a new one.';
		case 'INVALID_TOKEN':
		case 'INVALID_USER':
		case 'USER_NOT_FOUND':
			return 'This verification link is invalid. Log in again to receive a new one.';
		default:
			return undefined;
	}
}

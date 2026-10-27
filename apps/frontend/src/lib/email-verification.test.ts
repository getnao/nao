import { describe, expect, it } from 'vitest';

import {
	buildEmailVerificationCallbackUrl,
	getEmailVerificationErrorMessage,
	isEmailNotVerifiedError,
} from './email-verification';

describe('email verification flow helpers', () => {
	it('preserves only safe in-app redirects through the verification result callback', () => {
		expect(buildEmailVerificationCallbackUrl('/settings?tab=profile')).toBe(
			'/email-verified?redirect=%2Fsettings%3Ftab%3Dprofile',
		);
		expect(buildEmailVerificationCallbackUrl('https://attacker.example')).toBe('/email-verified');
	});

	it('recognizes unverified sign-in and gives verification token failures friendly messages', () => {
		expect(isEmailNotVerifiedError({ code: 'EMAIL_NOT_VERIFIED' })).toBe(true);
		expect(getEmailVerificationErrorMessage('TOKEN_EXPIRED')).toContain('expired');
		expect(getEmailVerificationErrorMessage('invalid_token')).toContain('invalid');
		expect(getEmailVerificationErrorMessage('OAUTH_ERROR')).toBeUndefined();
	});
});

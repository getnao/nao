import { describe, expect, it } from 'vitest';

import { getSafeRedirectPath } from './safe-redirect';

describe('getSafeRedirectPath', () => {
	it('returns null for empty / nullish values', () => {
		expect(getSafeRedirectPath(undefined)).toBeNull();
		expect(getSafeRedirectPath(null)).toBeNull();
		expect(getSafeRedirectPath('')).toBeNull();
	});

	it('rejects non-rooted and protocol-relative paths', () => {
		expect(getSafeRedirectPath('foo')).toBeNull();
		expect(getSafeRedirectPath('https://evil.com/x')).toBeNull();
		expect(getSafeRedirectPath('//evil.com/x')).toBeNull();
		expect(getSafeRedirectPath('/\\evil.com')).toBeNull();
	});

	it('rejects auth pages, including with trailing slashes or different casing', () => {
		expect(getSafeRedirectPath('/login')).toBeNull();
		expect(getSafeRedirectPath('/login/')).toBeNull();
		expect(getSafeRedirectPath('/login//')).toBeNull();
		expect(getSafeRedirectPath('/Login')).toBeNull();
		expect(getSafeRedirectPath('/LOGIN/')).toBeNull();
		expect(getSafeRedirectPath('/signup')).toBeNull();
		expect(getSafeRedirectPath('/signup/?foo=bar')).toBeNull();
		expect(getSafeRedirectPath('/forgot-password#hash')).toBeNull();
		expect(getSafeRedirectPath('/reset-password')).toBeNull();
	});

	it('passes through safe in-app paths and preserves the original value', () => {
		expect(getSafeRedirectPath('/')).toBe('/');
		expect(getSafeRedirectPath('/settings/account')).toBe('/settings/account');
		expect(getSafeRedirectPath('/settings/account?tab=profile')).toBe('/settings/account?tab=profile');
		expect(getSafeRedirectPath('/some-chat-id#section')).toBe('/some-chat-id#section');
		expect(getSafeRedirectPath('/login-history')).toBe('/login-history');
	});
});

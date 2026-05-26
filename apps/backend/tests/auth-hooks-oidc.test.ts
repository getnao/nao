import { describe, expect, it } from 'vitest';

import { isEmailDomainAllowed, resolveProviderId } from '../src/utils/utils';

describe('OIDC domain allowlist via isEmailDomainAllowed', () => {
	it('allows when email domain is in the allowlist', () => {
		expect(isEmailDomainAllowed('user@allowed.com', 'allowed.com,other.com')).toBe(true);
	});

	it('allows second domain in the allowlist', () => {
		expect(isEmailDomainAllowed('user@other.com', 'allowed.com,other.com')).toBe(true);
	});

	it('rejects when email domain is not in the allowlist', () => {
		expect(isEmailDomainAllowed('user@blocked.com', 'allowed.com,other.com')).toBe(false);
	});

	it('allows any domain when allowlist is empty string', () => {
		expect(isEmailDomainAllowed('user@anything.com', '')).toBe(true);
	});

	it('allows any domain when allowlist is undefined', () => {
		expect(isEmailDomainAllowed('user@anything.com', undefined)).toBe(true);
	});

	it('is case-insensitive on domain comparison', () => {
		expect(isEmailDomainAllowed('user@ALLOWED.COM', 'allowed.com')).toBe(true);
		expect(isEmailDomainAllowed('user@allowed.com', 'ALLOWED.COM')).toBe(true);
	});

	it('trims whitespace in allowlist entries', () => {
		expect(isEmailDomainAllowed('user@allowed.com', ' allowed.com , other.com ')).toBe(true);
	});

	it('rejects malformed email without @ symbol', () => {
		expect(isEmailDomainAllowed('noemail', 'allowed.com')).toBe(false);
	});

	it('rejects email with empty domain part', () => {
		expect(isEmailDomainAllowed('user@', 'allowed.com')).toBe(false);
	});

	it('does not match subdomains', () => {
		expect(isEmailDomainAllowed('user@sub.allowed.com', 'allowed.com')).toBe(false);
	});
});

describe('resolveProviderId', () => {
	it('returns params.id for social providers', () => {
		expect(resolveProviderId({ params: { id: 'google' } })).toBe('google');
	});

	it('returns params.providerId for genericOAuth (OIDC)', () => {
		expect(resolveProviderId({ params: { providerId: 'okta' } })).toBe('okta');
	});

	it('prefers params.id over params.providerId when both are present', () => {
		expect(resolveProviderId({ params: { id: 'github', providerId: 'okta' } })).toBe('github');
	});

	it('returns undefined when ctx is undefined', () => {
		expect(resolveProviderId(undefined)).toBeUndefined();
	});

	it('returns undefined when ctx is null', () => {
		expect(resolveProviderId(null)).toBeUndefined();
	});

	it('returns undefined when params is empty', () => {
		expect(resolveProviderId({ params: {} })).toBeUndefined();
	});
});

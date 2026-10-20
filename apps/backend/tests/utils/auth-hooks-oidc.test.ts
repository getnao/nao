import { describe, expect, it } from 'vitest';

import { isEmailDomainAllowed, resolveProviderId } from '../../src/utils/utils';

describe('OIDC domain allowlist via isEmailDomainAllowed', () => {
	it.each([
		['allows when email domain is in the allowlist', 'user@allowed.com', 'allowed.com,other.com', true],
		['allows second domain in the allowlist', 'user@other.com', 'allowed.com,other.com', true],
		['rejects when email domain is not in the allowlist', 'user@blocked.com', 'allowed.com,other.com', false],
		['allows any domain when no allowlist is configured (empty string)', 'user@anything.com', '', true],
		['allows any domain when no allowlist is configured (undefined)', 'user@anything.com', undefined, true],
		['trims whitespace in allowlist entries', 'user@allowed.com', ' allowed.com , other.com ', true],
		['rejects malformed email without @ symbol', 'noemail', 'allowed.com', false],
		['rejects email with empty domain part', 'user@', 'allowed.com', false],
		['does not match subdomains', 'user@sub.allowed.com', 'allowed.com', false],
	])('%s', (_name, email, allowlist, expected) => {
		expect(isEmailDomainAllowed(email, allowlist)).toBe(expected);
	});

	it('is case-insensitive on domain comparison', () => {
		expect(isEmailDomainAllowed('user@ALLOWED.COM', 'allowed.com')).toBe(true);
		expect(isEmailDomainAllowed('user@allowed.com', 'ALLOWED.COM')).toBe(true);
	});
});

describe('resolveProviderId', () => {
	it.each([
		['returns params.id for social providers', { params: { id: 'google' } }, 'google'],
		['returns params.providerId for genericOAuth (OIDC)', { params: { providerId: 'okta' } }, 'okta'],
		[
			'prefers params.id over params.providerId when both are present',
			{ params: { id: 'github', providerId: 'okta' } },
			'github',
		],
		['returns undefined when ctx is undefined', undefined, undefined],
		['returns undefined when ctx is null', null, undefined],
		['returns undefined when params is empty', { params: {} }, undefined],
	])('%s', (_name, ctx, expected) => {
		expect(resolveProviderId(ctx)).toBe(expected);
	});
});

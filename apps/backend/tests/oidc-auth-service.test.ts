import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, unknown> = {};

vi.mock('../src/env', () => ({
	get env() {
		return mockEnv;
	},
}));

function setOidcEnv(overrides: Record<string, string> = {}) {
	mockEnv.OIDC_CLIENT_ID = 'client-id';
	mockEnv.OIDC_CLIENT_SECRET = 'secret';
	mockEnv.OIDC_DISCOVERY_URL = 'https://example.com/.well-known/openid-configuration';
	Object.assign(mockEnv, overrides);
}

import {
	augmentPluginsWithOidc,
	getOidcProviderId,
	getTrustedProvidersForOidc,
	isOidcConfigured,
	isSocialProviderOidc,
	parseScopes,
} from '../src/services/oidc-auth.service';

describe('oidc-auth.service', () => {
	beforeEach(() => {
		Object.keys(mockEnv).forEach((key) => delete mockEnv[key]);
	});

	describe('isOidcConfigured', () => {
		it('returns false when no env vars are set', () => {
			expect(isOidcConfigured()).toBe(false);
		});

		it('returns false when OIDC_CLIENT_ID is missing', () => {
			mockEnv.OIDC_CLIENT_SECRET = 'secret';
			mockEnv.OIDC_DISCOVERY_URL = 'https://example.com/.well-known/openid-configuration';
			expect(isOidcConfigured()).toBe(false);
		});

		it('returns false when OIDC_CLIENT_SECRET is missing', () => {
			mockEnv.OIDC_CLIENT_ID = 'client-id';
			mockEnv.OIDC_DISCOVERY_URL = 'https://example.com/.well-known/openid-configuration';
			expect(isOidcConfigured()).toBe(false);
		});

		it('returns false when OIDC_DISCOVERY_URL is missing', () => {
			mockEnv.OIDC_CLIENT_ID = 'client-id';
			mockEnv.OIDC_CLIENT_SECRET = 'secret';
			expect(isOidcConfigured()).toBe(false);
		});

		it('returns true when all required vars are set', () => {
			setOidcEnv();
			expect(isOidcConfigured()).toBe(true);
		});
	});

	describe('getOidcProviderId', () => {
		it('returns "oidc" by default', () => {
			expect(getOidcProviderId()).toBe('oidc');
		});

		it('returns custom value from OIDC_PROVIDER_ID', () => {
			mockEnv.OIDC_PROVIDER_ID = 'okta';
			expect(getOidcProviderId()).toBe('okta');
		});
	});

	describe('augmentPluginsWithOidc', () => {
		it('does not push any plugin when not configured', () => {
			const plugins: unknown[] = [];
			augmentPluginsWithOidc(plugins as never[]);
			expect(plugins).toHaveLength(0);
		});

		it('pushes a plugin when configured', () => {
			setOidcEnv();
			const plugins: unknown[] = [];
			augmentPluginsWithOidc(plugins as never[]);
			expect(plugins).toHaveLength(1);
		});

		it('preserves existing plugins in the array', () => {
			setOidcEnv();
			const existing = { id: 'existing-plugin' };
			const plugins: unknown[] = [existing];
			augmentPluginsWithOidc(plugins as never[]);
			expect(plugins).toHaveLength(2);
			expect(plugins[0]).toBe(existing);
		});
	});

	describe('getTrustedProvidersForOidc', () => {
		it('returns empty array when not configured', () => {
			expect(getTrustedProvidersForOidc()).toEqual([]);
		});

		it('returns default provider ID when configured', () => {
			setOidcEnv();
			expect(getTrustedProvidersForOidc()).toEqual(['oidc']);
		});

		it('returns custom provider ID when configured', () => {
			setOidcEnv({ OIDC_PROVIDER_ID: 'keycloak' });
			expect(getTrustedProvidersForOidc()).toEqual(['keycloak']);
		});
	});

	describe('isSocialProviderOidc', () => {
		it('returns true for default provider ID', () => {
			expect(isSocialProviderOidc('oidc')).toBe(true);
		});

		it('returns true for custom provider ID', () => {
			mockEnv.OIDC_PROVIDER_ID = 'auth0';
			expect(isSocialProviderOidc('auth0')).toBe(true);
		});

		it('returns false for other providers', () => {
			expect(isSocialProviderOidc('google')).toBe(false);
			expect(isSocialProviderOidc('microsoft')).toBe(false);
		});

		it('returns false for undefined', () => {
			expect(isSocialProviderOidc(undefined)).toBe(false);
		});
	});

	describe('parseScopes', () => {
		it('returns defaults when undefined', () => {
			expect(parseScopes(undefined)).toEqual(['openid', 'profile', 'email']);
		});

		it('returns defaults when empty string', () => {
			expect(parseScopes('')).toEqual(['openid', 'profile', 'email']);
		});

		it('parses comma-separated scopes', () => {
			expect(parseScopes('openid,profile,email,groups')).toEqual(['openid', 'profile', 'email', 'groups']);
		});

		it('trims whitespace around scopes', () => {
			expect(parseScopes(' openid , profile , email ')).toEqual(['openid', 'profile', 'email']);
		});

		it('filters out empty entries from extra commas', () => {
			expect(parseScopes('openid,,email')).toEqual(['openid', 'email']);
		});

		it('returns defaults when only commas', () => {
			expect(parseScopes(',,')).toEqual(['openid', 'profile', 'email']);
		});
	});
});

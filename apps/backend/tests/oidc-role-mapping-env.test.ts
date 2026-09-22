import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DEPRECATION_WARNING =
	'OIDC_GROUP_ROLE_MAPPING is deprecated; use OIDC_GROUP_NAO_ROLE_MAPPING instead. Support for the old name will be removed in a future release.';

vi.mock('dotenv', () => ({
	default: { config: vi.fn() },
}));

describe('OIDC organization-role mapping environment migration', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
		delete process.env.OIDC_GROUP_NAO_ROLE_MAPPING;
		delete process.env.OIDC_GROUP_ROLE_MAPPING;
		vi.resetModules();
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();
	});

	it('uses the canonical variable when it is set alone', async () => {
		process.env.OIDC_GROUP_NAO_ROLE_MAPPING = 'nao-admins:admin';

		const { env } = await import('../src/env');

		expect(env.OIDC_GROUP_NAO_ROLE_MAPPING).toBe('nao-admins:admin');
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('uses the deprecated variable as a fallback', async () => {
		process.env.OIDC_GROUP_ROLE_MAPPING = 'nao-viewers:viewer';

		const { env } = await import('../src/env');

		expect(env.OIDC_GROUP_NAO_ROLE_MAPPING).toBe('nao-viewers:viewer');
		expect(console.warn).toHaveBeenCalledWith(DEPRECATION_WARNING);
	});

	it('prefers the canonical variable and warns that the deprecated value is ignored', async () => {
		process.env.OIDC_GROUP_NAO_ROLE_MAPPING = 'nao-admins:admin';
		process.env.OIDC_GROUP_ROLE_MAPPING = 'nao-viewers:viewer';

		const { env } = await import('../src/env');

		expect(env.OIDC_GROUP_NAO_ROLE_MAPPING).toBe('nao-admins:admin');
		expect(console.warn).toHaveBeenCalledWith(
			`${DEPRECATION_WARNING} OIDC_GROUP_ROLE_MAPPING is ignored because OIDC_GROUP_NAO_ROLE_MAPPING is set.`,
		);
	});

	it('emits the deprecation warning only once across environment reloads', async () => {
		process.env.OIDC_GROUP_ROLE_MAPPING = 'nao-viewers:viewer';

		const { __reloadEnvForTesting } = await import('../src/env');
		__reloadEnvForTesting();
		__reloadEnvForTesting();

		expect(console.warn).toHaveBeenCalledTimes(1);
	});
});

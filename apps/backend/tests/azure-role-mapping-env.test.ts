import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DEPRECATION_WARNING =
	'AZURE_AD_GROUP_ROLE_MAPPING is deprecated; use AZURE_AD_GROUP_NAO_ROLE_MAPPING instead. Support for the old name will be removed in a future release.';

vi.mock('dotenv', () => ({
	default: { config: vi.fn() },
}));

describe('Microsoft Entra organization-role mapping environment migration', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
		delete process.env.AZURE_AD_GROUP_NAO_ROLE_MAPPING;
		delete process.env.AZURE_AD_GROUP_ROLE_MAPPING;
		vi.resetModules();
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();
	});

	it('uses the canonical variable when it is set alone', async () => {
		process.env.AZURE_AD_GROUP_NAO_ROLE_MAPPING = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789:admin';

		const { env } = await import('../src/env');

		expect(env.AZURE_AD_GROUP_NAO_ROLE_MAPPING).toBe('a0b1c2d3-e4f5-6789-abcd-ef0123456789:admin');
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('uses the deprecated variable as a fallback', async () => {
		process.env.AZURE_AD_GROUP_ROLE_MAPPING = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789:viewer';

		const { env } = await import('../src/env');

		expect(env.AZURE_AD_GROUP_NAO_ROLE_MAPPING).toBe('a0b1c2d3-e4f5-6789-abcd-ef0123456789:viewer');
		expect(console.warn).toHaveBeenCalledWith(DEPRECATION_WARNING);
	});

	it('prefers the canonical variable and warns that the deprecated value is ignored', async () => {
		process.env.AZURE_AD_GROUP_NAO_ROLE_MAPPING = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789:admin';
		process.env.AZURE_AD_GROUP_ROLE_MAPPING = 'invalid-deprecated-value';

		const { env } = await import('../src/env');

		expect(env.AZURE_AD_GROUP_NAO_ROLE_MAPPING).toBe('a0b1c2d3-e4f5-6789-abcd-ef0123456789:admin');
		expect(console.warn).toHaveBeenCalledWith(
			`${DEPRECATION_WARNING} AZURE_AD_GROUP_ROLE_MAPPING is ignored because AZURE_AD_GROUP_NAO_ROLE_MAPPING is set.`,
		);
	});

	it('emits the deprecation warning only once across environment reloads', async () => {
		process.env.AZURE_AD_GROUP_ROLE_MAPPING = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789:viewer';

		const { __reloadEnvForTesting } = await import('../src/env');
		__reloadEnvForTesting();
		__reloadEnvForTesting();

		expect(console.warn).toHaveBeenCalledTimes(1);
	});
});

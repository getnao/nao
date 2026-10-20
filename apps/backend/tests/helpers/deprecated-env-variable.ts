import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { env } from '../../src/env';
import { restoreProcessEnvAfterEach } from './process-env-snapshot';

interface DeprecatedEnvVariableMigration {
	title: string;
	canonicalName: keyof typeof env & string;
	deprecatedName: string;
	canonicalValue: string;
	deprecatedValue: string;
	ignoredDeprecatedValue: string;
}

/** Requires the calling test file to mock `dotenv`, so only `process.env` feeds each fresh env import. */
export function describeDeprecatedEnvVariableMigration({
	title,
	canonicalName,
	deprecatedName,
	canonicalValue,
	deprecatedValue,
	ignoredDeprecatedValue,
}: DeprecatedEnvVariableMigration): void {
	const deprecationWarning = `${deprecatedName} is deprecated; use ${canonicalName} instead. Support for the old name will be removed in a future release.`;

	describe(title, () => {
		restoreProcessEnvAfterEach({
			unset: [canonicalName, deprecatedName],
			afterRestore: () => vi.restoreAllMocks(),
		});

		beforeEach(() => {
			vi.resetModules();
			vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		});

		it('uses the canonical variable when it is set alone', async () => {
			process.env[canonicalName] = canonicalValue;

			const { env: parsedEnv } = await import('../../src/env');

			expect(parsedEnv[canonicalName]).toBe(canonicalValue);
			expect(console.warn).not.toHaveBeenCalled();
		});

		it('uses the deprecated variable as a fallback', async () => {
			process.env[deprecatedName] = deprecatedValue;

			const { env: parsedEnv } = await import('../../src/env');

			expect(parsedEnv[canonicalName]).toBe(deprecatedValue);
			expect(console.warn).toHaveBeenCalledWith(deprecationWarning);
		});

		it('prefers the canonical variable and warns that the deprecated value is ignored', async () => {
			process.env[canonicalName] = canonicalValue;
			process.env[deprecatedName] = ignoredDeprecatedValue;

			const { env: parsedEnv } = await import('../../src/env');

			expect(parsedEnv[canonicalName]).toBe(canonicalValue);
			expect(console.warn).toHaveBeenCalledWith(
				`${deprecationWarning} ${deprecatedName} is ignored because ${canonicalName} is set.`,
			);
		});

		it('emits the deprecation warning only once across environment reloads', async () => {
			process.env[deprecatedName] = deprecatedValue;

			const { __reloadEnvForTesting } = await import('../../src/env');
			__reloadEnvForTesting();
			__reloadEnvForTesting();

			expect(console.warn).toHaveBeenCalledTimes(1);
		});
	});
}

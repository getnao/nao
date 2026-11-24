import { describe, expect, it } from 'vitest';

import { __reloadEnvForTesting, env } from '../../src/env';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';

describe('ALLOW_UNAUTHENTICATED_DCR env', () => {
	restoreProcessEnvAfterEach({ unset: ['ALLOW_UNAUTHENTICATED_DCR'], afterRestore: __reloadEnvForTesting });

	it('defaults to true (preserves prior behavior)', () => {
		__reloadEnvForTesting();
		expect(env.ALLOW_UNAUTHENTICATED_DCR).toBe(true);
	});

	it('can be disabled with "false"', () => {
		process.env.ALLOW_UNAUTHENTICATED_DCR = 'false';
		__reloadEnvForTesting();
		expect(env.ALLOW_UNAUTHENTICATED_DCR).toBe(false);
	});

	it('accepts "true"', () => {
		process.env.ALLOW_UNAUTHENTICATED_DCR = 'true';
		__reloadEnvForTesting();
		expect(env.ALLOW_UNAUTHENTICATED_DCR).toBe(true);
	});
});

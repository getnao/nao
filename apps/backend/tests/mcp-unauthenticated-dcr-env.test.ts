import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reloadEnvForTesting, env } from '../src/env';

// ALLOW_UNAUTHENTICATED_DCR is parsed from env at load; __reloadEnvForTesting re-parses
// process.env in place (without re-running dotenv) so cases can mutate it between runs.
describe('ALLOW_UNAUTHENTICATED_DCR env', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
		delete process.env.ALLOW_UNAUTHENTICATED_DCR;
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

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

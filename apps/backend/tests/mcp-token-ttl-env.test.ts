import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reloadEnvForTesting, env } from '../src/env';

// MCP_ACCESS_TOKEN_TTL / MCP_REFRESH_TOKEN_TTL are parsed from env at load;
// __reloadEnvForTesting re-parses process.env in place (without re-running dotenv)
// so cases can mutate it between runs. It throws with a stable "Invalid env during
// test reload" message on a validation failure, which the negative cases assert on.
describe('MCP token TTL env', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
		delete process.env.MCP_ACCESS_TOKEN_TTL;
		delete process.env.MCP_REFRESH_TOKEN_TTL;
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

	it('defaults to 24h access / 7d refresh when unset', () => {
		__reloadEnvForTesting();
		expect(env.MCP_ACCESS_TOKEN_TTL).toBe(86400);
		expect(env.MCP_REFRESH_TOKEN_TTL).toBe(604800);
	});

	it('honors overrides', () => {
		process.env.MCP_ACCESS_TOKEN_TTL = '3600';
		process.env.MCP_REFRESH_TOKEN_TTL = '86400';
		__reloadEnvForTesting();
		expect(env.MCP_ACCESS_TOKEN_TTL).toBe(3600);
		expect(env.MCP_REFRESH_TOKEN_TTL).toBe(86400);
	});

	it('rejects a non-positive access TTL', () => {
		process.env.MCP_ACCESS_TOKEN_TTL = '0';
		expect(() => __reloadEnvForTesting()).toThrow(/Invalid env during test reload/);
	});

	it('rejects a non-positive refresh TTL', () => {
		process.env.MCP_REFRESH_TOKEN_TTL = '0';
		expect(() => __reloadEnvForTesting()).toThrow(/Invalid env during test reload/);
	});

	it('rejects a refresh TTL that does not outlive the access TTL', () => {
		process.env.MCP_ACCESS_TOKEN_TTL = '7200';
		process.env.MCP_REFRESH_TOKEN_TTL = '3600';
		expect(() => __reloadEnvForTesting()).toThrow(/MCP_REFRESH_TOKEN_TTL/);
	});
});

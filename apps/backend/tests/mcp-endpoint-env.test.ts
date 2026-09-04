import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	storedSettings: null as Record<string, unknown> | null,
}));

vi.mock('../src/db/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () => ({
						execute: async () => [{ mcpEndpointSettings: testState.storedSettings }],
					}),
				}),
			}),
		}),
	},
}));

import { __reloadEnvForTesting } from '../src/env';
import { getMcpEndpointSettings } from '../src/queries/mcp-endpoint.queries';

describe('MCP_ENDPOINT_ENABLED default', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
		testState.storedSettings = null;
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

	function setEnvToggle(value: string | undefined) {
		if (value === undefined) {
			delete process.env.MCP_ENDPOINT_ENABLED;
		} else {
			process.env.MCP_ENDPOINT_ENABLED = value;
		}
		__reloadEnvForTesting();
	}

	it('keeps the built-in default (disabled) when unset', async () => {
		setEnvToggle(undefined);
		const settings = await getMcpEndpointSettings('project-1');
		expect(settings.enabled).toBe(false);
		expect(settings.subAgentModeEnabled).toBe(true);
		expect(settings.contextLayerModeEnabled).toBe(true);
	});

	it('enables the endpoint for projects with no stored settings', async () => {
		setEnvToggle('true');
		const settings = await getMcpEndpointSettings('project-1');
		expect(settings.enabled).toBe(true);
		expect(settings.subAgentModeEnabled).toBe(true);
	});

	it('can also pin the default to disabled explicitly', async () => {
		setEnvToggle('false');
		expect((await getMcpEndpointSettings('project-1')).enabled).toBe(false);
	});

	it('never overrides settings an admin saved', async () => {
		testState.storedSettings = { enabled: false, subAgentModeEnabled: false, contextLayerModeEnabled: true };
		setEnvToggle('true');
		const settings = await getMcpEndpointSettings('project-1');
		expect(settings.enabled).toBe(false);
		expect(settings.subAgentModeEnabled).toBe(false);
	});

	it('rejects values other than true/false at env parse time', () => {
		process.env.MCP_ENDPOINT_ENABLED = 'yes';
		expect(() => __reloadEnvForTesting()).toThrow();
	});
});

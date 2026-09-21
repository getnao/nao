import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	dbConfig: null as Record<string, unknown> | null,
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: vi.fn(async () => null),
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigByProvider: vi.fn(async () => testState.dbConfig),
	getProjectLlmConfigs: vi.fn(async () => []),
}));

import { __reloadEnvForTesting, env } from '../src/env';
import { getEnvProviders, hasEnvApiKey, isProviderDisabled, resolveProviderSettings } from '../src/utils/llm';

describe('DISABLED_PROVIDERS', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
		testState.dbConfig = null;
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

	function setDisabledProviders(value: string | undefined) {
		if (value === undefined) {
			delete process.env.DISABLED_PROVIDERS;
		} else {
			process.env.DISABLED_PROVIDERS = value;
		}
		__reloadEnvForTesting();
	}

	it('defaults to an empty list', () => {
		setDisabledProviders(undefined);
		expect(env.DISABLED_PROVIDERS).toEqual([]);
		expect(isProviderDisabled('bedrock')).toBe(false);
	});

	it('parses a comma-separated list, ignoring whitespace and empty entries', () => {
		setDisabledProviders(' bedrock , vertex ,');
		expect(env.DISABLED_PROVIDERS).toEqual(['bedrock', 'vertex']);
		expect(isProviderDisabled('bedrock')).toBe(true);
		expect(isProviderDisabled('vertex')).toBe(true);
		expect(isProviderDisabled('anthropic')).toBe(false);
	});

	it('rejects unknown provider ids', () => {
		process.env.DISABLED_PROVIDERS = 'bedrock,not-a-provider';
		expect(() => __reloadEnvForTesting()).toThrow(/DISABLED_PROVIDERS/);
		delete process.env.DISABLED_PROVIDERS;
		__reloadEnvForTesting();
	});

	it('rejects malformed named-instance ids', () => {
		process.env.DISABLED_PROVIDERS = 'openaiCompatible/Bad_Name';
		expect(() => __reloadEnvForTesting()).toThrow(/DISABLED_PROVIDERS/);
		process.env.DISABLED_PROVIDERS = 'anthropic/some-name';
		expect(() => __reloadEnvForTesting()).toThrow(/DISABLED_PROVIDERS/);
		delete process.env.DISABLED_PROVIDERS;
		__reloadEnvForTesting();
	});

	it('disabling a kind covers its named instances, and an instance can be disabled alone', () => {
		setDisabledProviders('openaiCompatible');
		expect(isProviderDisabled('openaiCompatible/my-vllm')).toBe(true);

		setDisabledProviders('openaiCompatible/my-vllm');
		expect(isProviderDisabled('openaiCompatible/my-vllm')).toBe(true);
		expect(isProviderDisabled('openaiCompatible/other')).toBe(false);
		expect(isProviderDisabled('openaiCompatible')).toBe(false);
	});

	it('keeps a disabled provider from auto-registering off ambient credentials', () => {
		process.env.AWS_WEB_IDENTITY_TOKEN_FILE = '/var/run/secrets/token';
		setDisabledProviders(undefined);
		expect(hasEnvApiKey('bedrock')).toBe(true);
		expect(getEnvProviders()).toContain('bedrock');

		setDisabledProviders('bedrock');
		expect(hasEnvApiKey('bedrock')).toBe(false);
		expect(getEnvProviders()).not.toContain('bedrock');
	});

	it('overrides credentials configured in the database', async () => {
		testState.dbConfig = { apiKey: 'db-key', baseUrl: null, credentials: null, modelSettings: {} };
		setDisabledProviders(undefined);
		expect(await resolveProviderSettings('project-1', 'bedrock')).not.toBeNull();

		setDisabledProviders('bedrock');
		expect(await resolveProviderSettings('project-1', 'bedrock')).toBeNull();
	});
});

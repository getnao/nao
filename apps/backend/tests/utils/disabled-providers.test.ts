import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	dbConfig: null as Record<string, unknown> | null,
	dbConfigs: [] as Record<string, unknown>[],
}));

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

vi.mock('../../src/queries/project.queries', () => ({
	getProjectById: vi.fn(async () => null),
}));

vi.mock('../../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigByProvider: vi.fn(async () => testState.dbConfig),
	getProjectLlmConfigs: vi.fn(async () => testState.dbConfigs),
}));

import { isManagedAiEnabled } from '../../src/agents/managed-ai';
import { __reloadEnvForTesting, env } from '../../src/env';
import {
	getEnvProviders,
	getProjectAvailableModels,
	hasEnvApiKey,
	isProviderDisabled,
	resolveProviderSettings,
} from '../../src/utils/llm';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';

describe('DISABLED_PROVIDERS', () => {
	restoreProcessEnvAfterEach({ afterRestore: __reloadEnvForTesting });

	beforeEach(() => {
		testState.dbConfig = null;
		testState.dbConfigs = [];
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
	});

	it('rejects malformed named-instance ids', () => {
		process.env.DISABLED_PROVIDERS = 'openaiCompatible/Bad_Name';
		expect(() => __reloadEnvForTesting()).toThrow(/DISABLED_PROVIDERS/);
		process.env.DISABLED_PROVIDERS = 'anthropic/some-name';
		expect(() => __reloadEnvForTesting()).toThrow(/DISABLED_PROVIDERS/);
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

	it('never auto-registers the nao-managed key as an environment provider', () => {
		process.env.NAO_MANAGED_OPENAI_API_KEY = 'managed-key';
		process.env.NAO_MODE = 'cloud';
		process.env.CLOUD_GITHUB_PROJECT_ORG = 'test-org';
		process.env.CLOUD_GITHUB_PROJECT_APP_ID = '123';
		process.env.CLOUD_GITHUB_PROJECT_INSTALLATION_ID = '456';
		process.env.CLOUD_GITHUB_PROJECT_PRIVATE_KEY = 'test-private-key';
		process.env.SMTP_HOST = 'smtp.example.com';
		process.env.SMTP_MAIL_FROM = 'hello@example.com';
		process.env.SMTP_PASSWORD = 'secret';
		setDisabledProviders(undefined);
		expect(env.NAO_MANAGED_OPENAI_API_KEY).toBe('managed-key');
		expect(isManagedAiEnabled()).toBe(true);
		expect(hasEnvApiKey('nao')).toBe(false);
		expect(getEnvProviders()).not.toContain('nao');

		setDisabledProviders('nao');
		expect(isManagedAiEnabled()).toBe(false);

		process.env.NAO_MODE = 'self-hosted';
		setDisabledProviders(undefined);
		expect(isManagedAiEnabled()).toBe(false);
	});

	it('overrides credentials configured in the database', async () => {
		testState.dbConfig = {
			provider: 'bedrock',
			apiKey: 'db-key',
			baseUrl: null,
			credentials: null,
			modelSettings: {},
		};
		setDisabledProviders(undefined);
		expect(await resolveProviderSettings('project-1', 'bedrock')).not.toBeNull();

		setDisabledProviders('bedrock');
		expect(await resolveProviderSettings('project-1', 'bedrock')).toBeNull();
	});

	it('keeps disabled database credentials out of the model catalog', async () => {
		testState.dbConfigs = [
			{
				id: 'config-1',
				name: 'Bedrock',
				provider: 'bedrock',
				credentialSource: 'database',
				enabledModels: ['anthropic.claude-sonnet-4-6-v1:0'],
				customModels: [],
				baseUrl: null,
			},
		];
		setDisabledProviders('bedrock');

		await expect(getProjectAvailableModels('project-1')).resolves.not.toContainEqual(
			expect.objectContaining({ provider: 'bedrock' }),
		);
	});
});

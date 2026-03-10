import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
	readFileSync: vi.fn<() => string>(),
	getProjectLlmConfigByProvider: vi.fn(),
	getProjectLlmConfigs: vi.fn(),
}));

vi.mock('node:fs', () => ({ readFileSync: mocks.readFileSync }));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigByProvider: mocks.getProjectLlmConfigByProvider,
	getProjectLlmConfigs: mocks.getProjectLlmConfigs,
}));

const { resolveProviderSettings, resolveProviderModel, getProjectAvailableModels } = await import('../src/utils/llm');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setNaoConfig(llm: { provider: string; api_key: string } | null) {
	if (llm === null) {
		mocks.readFileSync.mockImplementation(() => {
			throw new Error('file not found');
		});
	} else {
		mocks.readFileSync.mockReturnValue(`llm:\n  provider: ${llm.provider}\n  api_key: ${llm.api_key}`);
	}
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	process.env.NAO_DEFAULT_PROJECT_PATH = '/fake/project';
	mocks.getProjectLlmConfigByProvider.mockResolvedValue(null);
	mocks.getProjectLlmConfigs.mockResolvedValue([]);
	delete process.env.ANTHROPIC_API_KEY;
	delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
	delete process.env.NAO_DEFAULT_PROJECT_PATH;
});

// ---------------------------------------------------------------------------
// resolveProviderSettings
// ---------------------------------------------------------------------------

describe('resolveProviderSettings', () => {
	it('returns null when no source has credentials', async () => {
		setNaoConfig(null);
		expect(await resolveProviderSettings('proj', 'anthropic')).toBeNull();
	});

	it('returns settings from nao_config.yaml when DB and env are empty', async () => {
		setNaoConfig({ provider: 'anthropic', api_key: 'sk-nao' });
		expect(await resolveProviderSettings('proj', 'anthropic')).toEqual({ apiKey: 'sk-nao' });
	});

	it('ignores nao_config.yaml when provider does not match', async () => {
		setNaoConfig({ provider: 'openai', api_key: 'sk-openai' });
		expect(await resolveProviderSettings('proj', 'anthropic')).toBeNull();
	});

	it('prefers env vars over nao_config.yaml', async () => {
		process.env.ANTHROPIC_API_KEY = 'sk-env';
		setNaoConfig({ provider: 'anthropic', api_key: 'sk-nao' });
		expect((await resolveProviderSettings('proj', 'anthropic'))?.apiKey).toBe('sk-env');
	});

	it('prefers DB config over nao_config.yaml', async () => {
		mocks.getProjectLlmConfigByProvider.mockResolvedValue({ apiKey: 'sk-db', baseUrl: null });
		setNaoConfig({ provider: 'anthropic', api_key: 'sk-nao' });
		expect((await resolveProviderSettings('proj', 'anthropic'))?.apiKey).toBe('sk-db');
	});
});

// ---------------------------------------------------------------------------
// resolveProviderModel
// ---------------------------------------------------------------------------

describe('resolveProviderModel', () => {
	it('returns null when no source has credentials', async () => {
		setNaoConfig(null);
		expect(await resolveProviderModel('proj', 'anthropic', 'claude-sonnet-4-5')).toBeNull();
	});

	it('returns a model from nao_config.yaml when DB and env are empty', async () => {
		setNaoConfig({ provider: 'anthropic', api_key: 'sk-nao' });
		expect(await resolveProviderModel('proj', 'anthropic', 'claude-sonnet-4-5')).not.toBeNull();
	});

	it('ignores nao_config.yaml when provider does not match', async () => {
		setNaoConfig({ provider: 'openai', api_key: 'sk-openai' });
		expect(await resolveProviderModel('proj', 'anthropic', 'claude-sonnet-4-5')).toBeNull();
	});

	it('prefers env vars over nao_config.yaml and does not read the file', async () => {
		process.env.ANTHROPIC_API_KEY = 'sk-env';
		setNaoConfig({ provider: 'anthropic', api_key: 'sk-nao' });
		expect(await resolveProviderModel('proj', 'anthropic', 'claude-sonnet-4-5')).not.toBeNull();
		expect(mocks.readFileSync).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// getProjectAvailableModels
// ---------------------------------------------------------------------------

describe('getProjectAvailableModels', () => {
	it('returns empty list when no source is configured', async () => {
		setNaoConfig(null);
		expect(await getProjectAvailableModels('proj')).toHaveLength(0);
	});

	it('includes the nao_config.yaml provider when not covered by DB or env', async () => {
		setNaoConfig({ provider: 'anthropic', api_key: 'sk-nao' });
		const models = await getProjectAvailableModels('proj');
		expect(models.some((m) => m.provider === 'anthropic')).toBe(true);
	});

	it('does not duplicate the provider when already in env', async () => {
		process.env.ANTHROPIC_API_KEY = 'sk-env';
		setNaoConfig({ provider: 'anthropic', api_key: 'sk-nao' });
		const models = await getProjectAvailableModels('proj');
		expect(models.filter((m) => m.provider === 'anthropic')).toHaveLength(1);
	});

	it('does not duplicate the provider when already in DB', async () => {
		mocks.getProjectLlmConfigs.mockResolvedValue([{ provider: 'anthropic', apiKey: 'sk-db', enabledModels: [] }]);
		setNaoConfig({ provider: 'anthropic', api_key: 'sk-nao' });
		const models = await getProjectAvailableModels('proj');
		expect(models.filter((m) => m.provider === 'anthropic')).toHaveLength(1);
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAnnotationModelId } from '../src/utils/llm';

const mocks = vi.hoisted(() => ({
	getProjectById: vi.fn(),
	getProjectLlmConfigByProvider: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: mocks.getProjectById,
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigByProvider: mocks.getProjectLlmConfigByProvider,
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('resolveAnnotationModelId', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectById.mockResolvedValue(null);
		mocks.getProjectLlmConfigByProvider.mockResolvedValue(null);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('uses the active model for a provider with a custom base URL', async () => {
		mocks.getProjectLlmConfigByProvider.mockResolvedValue({
			baseUrl: 'http://litellm.test/v1',
			enabledModels: ['gpt-4.1-mini', 'gpt-5.5'],
		});

		const modelId = await resolveAnnotationModelId(
			'project-1',
			{ provider: 'openai', modelId: 'gpt-5.5' },
			'gpt-4.1-mini',
		);

		expect(modelId).toBe('gpt-5.5');
	});

	it('keeps the configured annotation model for a provider without a custom base URL', async () => {
		mocks.getProjectLlmConfigByProvider.mockResolvedValue({
			baseUrl: null,
			enabledModels: ['gpt-4.1-mini', 'gpt-5.5'],
		});

		const modelId = await resolveAnnotationModelId(
			'project-1',
			{ provider: 'openai', modelId: 'gpt-5.5' },
			'gpt-4.1-mini',
		);

		expect(modelId).toBe('gpt-4.1-mini');
	});

	it('uses the active model when the provider base URL comes from the environment', async () => {
		vi.stubEnv('OPENAI_BASE_URL', 'http://litellm.test/v1');

		const modelId = await resolveAnnotationModelId(
			'project-1',
			{ provider: 'openai', modelId: 'gpt-5.5' },
			'gpt-4.1-mini',
		);

		expect(modelId).toBe('gpt-5.5');
	});
});

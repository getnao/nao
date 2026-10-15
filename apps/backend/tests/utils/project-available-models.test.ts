import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getProjectAvailableModels } from '../../src/utils/llm';
import { useNaoConfigProjects } from '../helpers/nao-config-project';

const mocks = vi.hoisted(() => ({
	getProjectById: vi.fn(),
	getProjectLlmConfigs: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({
	getProjectById: mocks.getProjectById,
}));

vi.mock('../../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigs: mocks.getProjectLlmConfigs,
	getProjectLlmConfigByProvider: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const writeConfig = useNaoConfigProjects('nao-available-models-');

describe('getProjectAvailableModels', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectLlmConfigs.mockResolvedValue([]);
	});

	it('lists models from every named openai-compatible endpoint in nao_config.yaml', async () => {
		const dir = writeConfig([
			'llm:',
			'  providers:',
			'  - provider: openai-compatible',
			'    name: prod',
			'    base_url: http://prod:8000/v1',
			'    models:',
			'    - id: gpt-5.5',
			'  - provider: openai-compatible',
			'    name: staging',
			'    base_url: http://staging:8000/v1',
			'    models:',
			'    - id: claude-opus-4-8',
		]);
		mocks.getProjectById.mockResolvedValue({ path: dir, envVars: {} });

		const models = (await getProjectAvailableModels('project-1')).filter((model) =>
			model.provider.startsWith('openaiCompatible/'),
		);

		expect(models).toEqual([
			{
				provider: 'openaiCompatible/prod',
				modelId: 'gpt-5.5',
				name: 'gpt-5.5',
				baseUrl: 'http://prod:8000/v1',
			},
			{
				provider: 'openaiCompatible/staging',
				modelId: 'claude-opus-4-8',
				name: 'claude-opus-4-8',
				baseUrl: 'http://staging:8000/v1',
			},
		]);
	});
});

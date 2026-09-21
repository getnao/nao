import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProvidersCostSupport } from '../src/utils/budget';

const mocks = vi.hoisted(() => ({
	getProjectById: vi.fn(),
	getProjectLlmConfigs: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: mocks.getProjectById,
	listProjectMembersWithRoles: vi.fn(),
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigs: mocks.getProjectLlmConfigs,
	getProjectLlmConfigByProvider: vi.fn(),
}));

vi.mock('../src/queries/budget.queries', () => ({}));

vi.mock('../src/services/email', () => ({
	emailService: { isEnabled: () => false, sendEmail: vi.fn() },
}));

vi.mock('../src/services/license.service', () => ({
	hasFeature: vi.fn(),
	LICENSE_FEATURES: { userBudget: 'user-budget' },
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const dirs: string[] = [];

function writeConfig(lines: string[]): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-cost-support-'));
	dirs.push(dir);
	fs.writeFileSync(path.join(dir, 'nao_config.yaml'), lines.join('\n'));
	return dir;
}

describe('getProvidersCostSupport', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectLlmConfigs.mockResolvedValue([]);
		mocks.getProjectById.mockResolvedValue({ path: '/nonexistent', envVars: {} });
	});

	afterEach(() => {
		while (dirs.length > 0) {
			fs.rmSync(dirs.pop() as string, { force: true, recursive: true });
		}
	});

	it('supports providers whose models nao already prices', async () => {
		mocks.getProjectLlmConfigs.mockResolvedValue([
			{ provider: 'anthropic', enabledModels: ['claude-sonnet-4-6'], customModels: [], baseUrl: null },
		]);

		const support = await getProvidersCostSupport('project-1');

		expect(support.anthropic).toBe(true);
	});

	it('does not support an openai-compatible endpoint without declared costs', async () => {
		mocks.getProjectLlmConfigs.mockResolvedValue([
			{
				provider: 'openaiCompatible/vllm',
				enabledModels: ['llama-3'],
				customModels: [{ id: 'llama-3', displayName: 'Llama 3' }],
				baseUrl: 'http://vllm:8000/v1',
			},
		]);

		const support = await getProvidersCostSupport('project-1');

		expect(support['openaiCompatible/vllm']).toBe(false);
	});

	it('supports an openai-compatible endpoint once a model declares costs in the settings UI', async () => {
		mocks.getProjectLlmConfigs.mockResolvedValue([
			{
				provider: 'openaiCompatible/vllm',
				enabledModels: ['llama-3'],
				customModels: [{ id: 'llama-3', costPerM: { inputNoCache: 0.5, output: 1.5 } }],
				baseUrl: 'http://vllm:8000/v1',
			},
		]);

		const support = await getProvidersCostSupport('project-1');

		expect(support['openaiCompatible/vllm']).toBe(true);
	});

	it('supports an openai-compatible endpoint once a model declares costs in nao_config.yaml', async () => {
		const dir = writeConfig([
			'llm:',
			'  providers:',
			'  - provider: openai-compatible',
			'    name: prod',
			'    base_url: http://prod:8000/v1',
			'    models:',
			'    - id: llama-3',
			'      costs:',
			'        input_no_cache: 0.5',
			'        output: 1.5',
			'  - provider: openai-compatible',
			'    name: staging',
			'    base_url: http://staging:8000/v1',
			'    models:',
			'    - id: llama-3',
		]);
		mocks.getProjectById.mockResolvedValue({ path: dir, envVars: {} });

		const support = await getProvidersCostSupport('project-1');

		expect(support['openaiCompatible/prod']).toBe(true);
		expect(support['openaiCompatible/staging']).toBe(false);
	});
});

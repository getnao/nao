import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProjectAvailableModels } from '../src/utils/llm';

const mocks = vi.hoisted(() => ({
	getProjectById: vi.fn(),
	getProjectLlmConfigs: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: mocks.getProjectById,
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigs: mocks.getProjectLlmConfigs,
	getProjectLlmConfigByProvider: vi.fn(),
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const dirs: string[] = [];

function writeConfig(lines: string[]): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-available-models-'));
	dirs.push(dir);
	fs.writeFileSync(path.join(dir, 'nao_config.yaml'), lines.join('\n'));
	return dir;
}

describe('getProjectAvailableModels', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectLlmConfigs.mockResolvedValue([]);
	});

	afterEach(() => {
		while (dirs.length > 0) {
			fs.rmSync(dirs.pop() as string, { force: true, recursive: true });
		}
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

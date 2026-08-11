import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { findConfigLlmProvider, readProjectConfigLlm } from '../src/utils/nao-config-llm';

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const dirs: string[] = [];

function writeConfig(lines: string[]): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-llm-'));
	dirs.push(dir);
	fs.writeFileSync(path.join(dir, 'nao_config.yaml'), lines.join('\n'));
	return dir;
}

afterEach(() => {
	while (dirs.length > 0) {
		fs.rmSync(dirs.pop() as string, { force: true, recursive: true });
	}
	delete process.env.TEST_OPENAI_KEY;
});

describe('readProjectConfigLlm', () => {
	it('reads providers with their models, display names, costs and settings', () => {
		const dir = writeConfig([
			'project_name: demo',
			'llm:',
			'  annotation_model: gpt-4.1-mini',
			'  providers:',
			'  - provider: openai',
			'    api_key: sk-openai',
			'    base_url: http://localhost:4000',
			'    models:',
			'    - id: gpt-4.1-mini',
			'      name: GPT-4.1 mini',
			'      costs:',
			'        input_no_cache: 0.4',
			'        output: 1.6',
			'    - id: gpt-4.1',
			'      default: true',
			'      settings:',
			'        reasoning_effort: high',
		]);

		expect(readProjectConfigLlm(dir)).toEqual({
			annotationModel: 'gpt-4.1-mini',
			providers: [
				{
					provider: 'openai',
					apiKey: 'sk-openai',
					baseUrl: 'http://localhost:4000',
					credentials: null,
					enabledModels: ['gpt-4.1', 'gpt-4.1-mini'],
					customModels: [
						{
							id: 'gpt-4.1-mini',
							displayName: 'GPT-4.1 mini',
							costPerM: { inputNoCache: 0.4, output: 1.6 },
						},
					],
					modelSettings: { 'gpt-4.1': { reasoningEffort: 'high' } },
					budget: null,
				},
			],
		});
	});

	it('nests a legacy single provider block under providers', () => {
		const dir = writeConfig([
			'llm:',
			'  provider: anthropic',
			'  api_key: sk-ant',
			'  meta:',
			'    costs:',
			'      output: 15',
		]);

		const config = readProjectConfigLlm(dir);

		expect(config?.providers).toEqual([
			{
				provider: 'anthropic',
				apiKey: 'sk-ant',
				baseUrl: null,
				credentials: null,
				enabledModels: [],
				customModels: [],
				modelSettings: {},
				budget: null,
			},
		]);
	});

	it('reads a provider budget with its limits and period', () => {
		const dir = writeConfig([
			'llm:',
			'  providers:',
			'  - provider: openai',
			'    api_key: sk-openai',
			'    budget:',
			'      limit: 100',
			'      per_user_limit: 20',
			'      period: week',
			'  - provider: anthropic',
			'    api_key: sk-ant',
			'    budget:',
			'      per_user_limit: 5',
		]);

		const config = readProjectConfigLlm(dir);

		expect(findConfigLlmProvider(config, 'openai')?.budget).toEqual({
			limitUsd: 100,
			perUserLimitUsd: 20,
			period: 'week',
		});
		expect(findConfigLlmProvider(config, 'anthropic')?.budget).toEqual({
			limitUsd: 0,
			perUserLimitUsd: 5,
			period: 'month',
		});
	});

	it('drops a budget that sets no positive limit', () => {
		const dir = writeConfig([
			'llm:',
			'  providers:',
			'  - provider: openai',
			'    api_key: sk-openai',
			'    budget:',
			'      limit: 0',
			'      period: month',
		]);

		expect(findConfigLlmProvider(readProjectConfigLlm(dir), 'openai')?.budget).toBeNull();
	});

	it('resolves env placeholders from the project env vars then the process env', () => {
		process.env.TEST_OPENAI_KEY = 'sk-from-process';
		const dir = writeConfig([
			'llm:',
			'  providers:',
			'  - provider: openai',
			'    api_key: "{{ env(\'TEST_OPENAI_KEY\') }}"',
		]);

		expect(readProjectConfigLlm(dir)?.providers[0].apiKey).toBe('sk-from-process');
		expect(readProjectConfigLlm(dir, { TEST_OPENAI_KEY: 'sk-from-project' })?.providers[0].apiKey).toBe(
			'sk-from-project',
		);
	});

	it('drops values that only the CLI can resolve so the environment is used instead', () => {
		const dir = writeConfig([
			'llm:',
			'  providers:',
			'  - provider: openai',
			'    api_key: "{{ aws(\'openai/api_key\') }}"',
		]);

		expect(readProjectConfigLlm(dir)?.providers[0].apiKey).toBeNull();
	});

	it('maps provider credentials onto the names each provider expects', () => {
		const dir = writeConfig([
			'llm:',
			'  providers:',
			'  - provider: bedrock',
			'    access_key: AKIA',
			'    secret_key: secret',
			'    aws_region: us-east-1',
			'  - provider: gemini',
			'    api_key: gm-key',
		]);

		const config = readProjectConfigLlm(dir);

		expect(findConfigLlmProvider(config, 'bedrock')?.credentials).toEqual({
			accessKeyId: 'AKIA',
			secretAccessKey: 'secret',
			region: 'us-east-1',
		});
		expect(findConfigLlmProvider(config, 'google')?.apiKey).toBe('gm-key');
	});

	it('reads several named endpoints of the same provider', () => {
		const dir = writeConfig([
			'llm:',
			'  providers:',
			'  - provider: openai-compatible/My vLLM',
			'    base_url: http://vllm:8000/v1',
			'    models:',
			'    - id: llama-3.3-70b',
			'  - provider: openaiCompatible/litellm',
			'    api_key: sk-litellm',
			'    base_url: http://litellm:4000/v1',
		]);

		const config = readProjectConfigLlm(dir);

		expect(config?.providers.map((p) => p.provider)).toEqual([
			'openaiCompatible/my-vllm',
			'openaiCompatible/litellm',
		]);
		expect(findConfigLlmProvider(config, 'openaiCompatible/my-vllm')?.enabledModels).toEqual(['llama-3.3-70b']);
		expect(findConfigLlmProvider(config, 'openaiCompatible/litellm')?.apiKey).toBe('sk-litellm');
	});

	it('skips unknown providers and unsupported model settings', () => {
		const dir = writeConfig([
			'llm:',
			'  providers:',
			'  - provider: not-a-provider',
			'    api_key: nope',
			'  - provider: openai/named',
			'    api_key: nope',
			'  - provider: openai',
			'    api_key: sk-openai',
			'    models:',
			'    - id: gpt-4.1',
			'      settings:',
			'        made_up_setting: 3',
		]);

		const config = readProjectConfigLlm(dir);

		expect(config?.providers.map((p) => p.provider)).toEqual(['openai']);
		expect(config?.providers[0].modelSettings).toEqual({});
	});

	it('returns null when the project has no config, no llm block or an unusable one', () => {
		expect(readProjectConfigLlm(path.join(os.tmpdir(), 'nao-missing-project'))).toBeNull();
		expect(readProjectConfigLlm(writeConfig(['project_name: demo']))).toBeNull();
		expect(readProjectConfigLlm(writeConfig(['llm:', '  providers: []']))).toBeNull();
		expect(readProjectConfigLlm(writeConfig(['llm:', '  providers: not-a-list']))).toBeNull();
	});

	it('picks up edits to the config file', () => {
		const dir = writeConfig(['llm:', '  providers:', '  - provider: openai', '    api_key: sk-first']);
		expect(readProjectConfigLlm(dir)?.providers[0].apiKey).toBe('sk-first');

		const filePath = path.join(dir, 'nao_config.yaml');
		fs.writeFileSync(
			filePath,
			['llm:', '  providers:', '  - provider: openai', '    api_key: sk-second'].join('\n'),
		);
		fs.utimesSync(filePath, new Date(), new Date(Date.now() + 1000));

		expect(readProjectConfigLlm(dir)?.providers[0].apiKey).toBe('sk-second');
	});
});

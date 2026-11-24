import { describe, expect, it } from 'vitest';

import { formatTestSettingsYaml } from '@/lib/test-settings-yaml';

describe('formatTestSettingsYaml', () => {
	it('writes the picked models, efforts, times to ask each test and threads as the test block', () => {
		const yaml = formatTestSettingsYaml({
			models: [
				{ provider: 'openai', modelId: 'gpt-4.1' },
				{ provider: 'openai', modelId: 'gpt-5', reasoningEfforts: ['high', 'low'] },
				{
					provider: 'anthropic',
					modelId: 'claude-opus-4-6',
					reasoningEfforts: ['low', 'medium', 'high', 'max'],
				},
			],
			attempts: 3,
			threads: 6,
		});

		expect(yaml).toBe(
			[
				'test:',
				'  models:',
				'    - openai:gpt-4.1',
				'    - model: openai:gpt-5',
				'      reasoning_efforts: [low, high]',
				'    - model: anthropic:claude-opus-4-6',
				'      reasoning_efforts: all',
				'  k: 3',
				'  threads: 6',
				'',
			].join('\n'),
		);
	});

	it('leaves out efforts a model does not support', () => {
		const yaml = formatTestSettingsYaml({
			models: [{ provider: 'openai', modelId: 'gpt-4.1', reasoningEfforts: ['high'] }],
			attempts: 1,
			threads: 3,
		});

		expect(yaml).toContain('    - openai:gpt-4.1\n');
		expect(yaml).not.toContain('reasoning_efforts');
	});

	it('writes the credential ID of a picked model', () => {
		const yaml = formatTestSettingsYaml({
			models: [{ provider: 'openai', modelId: 'gpt-5', llmConfigId: 'credential-b' }],
			attempts: 1,
			threads: 1,
		});

		expect(yaml).toContain('    - model: openai:gpt-5\n      llm_config_id: credential-b\n');
	});

	it('quotes model ids that YAML would misread', () => {
		const yaml = formatTestSettingsYaml({
			models: [
				{ provider: 'ollama', modelId: 'llama3:8b' },
				{ provider: 'openai', modelId: 'my model #2' },
			],
			attempts: 1,
			threads: 1,
		});

		expect(yaml).toContain('    - ollama:llama3:8b\n');
		expect(yaml).toContain('    - "openai:my model #2"\n');
	});
});

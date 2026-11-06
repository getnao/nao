import { describe, expect, it } from 'vitest';

import { formatTestSettingsYaml } from './test-settings-yaml';

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
});

import { describe, expect, it } from 'vitest';

import { getModelCapabilities, getModelParameterSpec, isAnthropicApiModel } from '../src/agents/provider-meta';
import type { ParamControl } from '../src/types/llm';

describe('isAnthropicApiModel', () => {
	it('matches all direct Anthropic models', () => {
		expect(isAnthropicApiModel('anthropic', 'claude-sonnet-4-6')).toBe(true);
		expect(isAnthropicApiModel('anthropic', 'any-custom-id')).toBe(true);
	});

	it('matches Claude on Vertex but not Gemini on Vertex', () => {
		expect(isAnthropicApiModel('vertex', 'claude-sonnet-4-6')).toBe(true);
		expect(isAnthropicApiModel('vertex', 'gemini-3-flash-preview')).toBe(false);
	});

	it('matches Claude on Bedrock but not other Bedrock models', () => {
		expect(isAnthropicApiModel('bedrock', 'us.anthropic.claude-sonnet-4-6')).toBe(true);
		expect(isAnthropicApiModel('bedrock', 'deepseek.v3.2')).toBe(false);
	});

	it('does not match other providers, even for Claude model ids', () => {
		expect(isAnthropicApiModel('openai', 'gpt-5.5')).toBe(false);
		expect(isAnthropicApiModel('openrouter', 'anthropic/claude-sonnet-4.5')).toBe(false);
	});
});

describe('getModelCapabilities', () => {
	it('returns the declared capabilities for known models', () => {
		expect(getModelCapabilities('anthropic', 'claude-sonnet-4-6')).toMatchObject({
			thinking: 'adaptive',
			sampling: true,
			topK: false,
		});
		expect(getModelCapabilities('anthropic', 'claude-sonnet-4-5')).toMatchObject({
			thinking: 'budget',
			topK: true,
		});
		expect(getModelCapabilities('openai', 'gpt-5.5')).toMatchObject({ thinking: 'adaptive', sampling: false });
		expect(getModelCapabilities('openai', 'gpt-4.1')).toMatchObject({ thinking: 'none', sampling: true });
	});

	it('falls back to adaptive thinking for custom Anthropic models', () => {
		expect(getModelCapabilities('anthropic', 'claude-future-6')).toMatchObject({
			thinking: 'adaptive',
			sampling: true,
			topK: false,
		});
	});

	it('falls back to reasoning capabilities for custom OpenAI models', () => {
		expect(getModelCapabilities('openai', 'custom-model')).toMatchObject({
			thinking: 'adaptive',
			sampling: false,
			topK: false,
		});
	});

	it('falls back to reasoning plus sampling for custom Azure deployments', () => {
		expect(getModelCapabilities('azure', 'my-deployment')).toMatchObject({
			thinking: 'adaptive',
			sampling: true,
			topK: false,
		});
	});

	it('falls back to level-based thinking for custom Google models', () => {
		expect(getModelCapabilities('google', 'gemini-future')).toMatchObject({
			thinking: 'adaptive',
			sampling: true,
			topK: true,
		});
	});

	it('falls back per model family for custom Vertex models', () => {
		expect(getModelCapabilities('vertex', 'claude-custom')).toMatchObject({ thinking: 'adaptive', topK: false });
		expect(getModelCapabilities('vertex', 'gemini-custom')).toMatchObject({ thinking: 'adaptive', topK: true });
	});

	it('falls back to effort-based reasoning for custom OpenRouter models', () => {
		expect(getModelCapabilities('openrouter', 'some/custom-model')).toMatchObject({
			thinking: 'adaptive',
			sampling: true,
			topK: true,
		});
	});

	it('falls back to sampling-only for custom Mistral and Ollama models', () => {
		expect(getModelCapabilities('mistral', 'custom-mistral')).toMatchObject({ thinking: 'none', sampling: true });
		expect(getModelCapabilities('ollama', 'custom:1b')).toMatchObject({
			thinking: 'none',
			sampling: true,
			topK: true,
		});
	});

	it('falls back per model family for custom Bedrock models', () => {
		expect(getModelCapabilities('bedrock', 'anthropic.claude-3-7-sonnet')).toMatchObject({
			thinking: 'budget',
			topK: true,
		});
		expect(getModelCapabilities('bedrock', 'meta.llama4')).toMatchObject({ thinking: 'none', sampling: true });
	});
});

describe('getModelParameterSpec', () => {
	function controlByKey(controls: ParamControl[], key: string) {
		return controls.find((c) => c.key === key);
	}

	it('derives effort + exclusive sampling controls for adaptive Claude', () => {
		const controls = getModelParameterSpec('anthropic', 'claude-sonnet-4-6');

		expect(controls.map((c) => c.key)).toEqual([
			'reasoningEffort',
			'temperature',
			'topP',
			'maxOutputTokens',
			'parallelToolCalls',
			'sendReasoning',
			'speed',
			'inferenceGeo',
		]);
		expect(controlByKey(controls, 'reasoningEffort')).toMatchObject({
			kind: 'effort',
			options: ['off', 'low', 'medium', 'high', 'max'],
		});
		expect(controlByKey(controls, 'temperature')).toMatchObject({ max: 1, group: 'sampling' });
		expect(controlByKey(controls, 'topP')).toMatchObject({ group: 'sampling', exclusiveWith: 'temperature' });
		expect(controlByKey(controls, 'speed')).toMatchObject({ kind: 'select', options: ['standard', 'fast'] });
	});

	it('derives a budget control and topK for legacy Claude', () => {
		const controls = getModelParameterSpec('anthropic', 'claude-sonnet-4-5');

		expect(controls.map((c) => c.key)).toEqual([
			'thinkingBudgetTokens',
			'temperature',
			'topP',
			'topK',
			'maxOutputTokens',
			'parallelToolCalls',
			'sendReasoning',
			'speed',
			'inferenceGeo',
		]);
		expect(controlByKey(controls, 'thinkingBudgetTokens')).toMatchObject({
			kind: 'number',
			min: 1024,
			lessThan: 'maxOutputTokens',
		});
		expect(controlByKey(controls, 'topK')).toMatchObject({ group: 'sampling' });
	});

	it('bounds the Gemini 2.5 thinking budget control to each model API range', () => {
		const pro = getModelParameterSpec('google', 'gemini-2.5-pro');
		const flash = getModelParameterSpec('google', 'gemini-2.5-flash');

		expect(controlByKey(pro, 'thinkingBudgetTokens')).toMatchObject({ min: 1024, max: 32_768 });
		expect(controlByKey(flash, 'thinkingBudgetTokens')).toMatchObject({ min: 1024, max: 24_576 });
		expect(controlByKey(pro, 'thinkingBudgetTokens')).not.toHaveProperty('lessThan');
	});

	it('drops the Anthropic-first-party extras for Claude on Vertex', () => {
		const listed = getModelParameterSpec('vertex', 'claude-sonnet-4-6');
		const custom = getModelParameterSpec('vertex', 'claude-custom-model');

		for (const controls of [listed, custom]) {
			const keys = controls.map((c) => c.key);
			expect(keys).not.toContain('speed');
			expect(keys).not.toContain('inferenceGeo');
			expect(keys).toContain('parallelToolCalls');
			expect(keys).toContain('sendReasoning');
		}
	});

	it('exposes effort, verbosity and tool/tier options for OpenAI reasoning models', () => {
		const controls = getModelParameterSpec('openai', 'gpt-5.5');

		expect(controls.map((c) => c.key)).toEqual([
			'reasoningEffort',
			'maxOutputTokens',
			'textVerbosity',
			'reasoningSummary',
			'parallelToolCalls',
			'maxToolCalls',
			'serviceTier',
		]);
		expect(controlByKey(controls, 'reasoningEffort')).toMatchObject({
			options: ['off', 'minimal', 'low', 'medium', 'high'],
		});
		expect(controlByKey(controls, 'serviceTier')).toMatchObject({
			kind: 'select',
			options: ['auto', 'default', 'flex', 'priority'],
		});
	});

	it('exposes the full effort surface for custom OpenAI models', () => {
		const controls = getModelParameterSpec('openai', 'gpt-6-codex-max');

		expect(controlByKey(controls, 'reasoningEffort')).toMatchObject({
			options: ['off', 'minimal', 'low', 'medium', 'high', 'max'],
		});
	});

	it('exposes ungrouped sampling with temperature up to 2 for non-Claude models', () => {
		const controls = getModelParameterSpec('openai', 'gpt-4.1');

		expect(controls.map((c) => c.key)).toEqual([
			'temperature',
			'topP',
			'maxOutputTokens',
			'parallelToolCalls',
			'maxToolCalls',
			'serviceTier',
		]);
		expect(controlByKey(controls, 'temperature')).toMatchObject({ max: 2 });
		expect(controlByKey(controls, 'temperature')).not.toHaveProperty('group');
		expect(controlByKey(controls, 'topP')).not.toHaveProperty('exclusiveWith');
	});

	it('exposes the full control set for Gemini', () => {
		const controls = getModelParameterSpec('google', 'gemini-3.1-pro-preview');

		expect(controls.map((c) => c.key)).toEqual([
			'reasoningEffort',
			'temperature',
			'topP',
			'topK',
			'maxOutputTokens',
			'includeThoughts',
			'safetyThreshold',
			'mediaResolution',
			'serviceTier',
		]);
		expect(controlByKey(controls, 'reasoningEffort')).toMatchObject({
			options: ['off', 'low', 'medium', 'high'],
		});
		expect(controlByKey(controls, 'includeThoughts')).toMatchObject({ kind: 'boolean' });
	});

	it('offers minimal only on Gemini models that accept it', () => {
		const flash = getModelParameterSpec('google', 'gemini-3-flash-preview');
		const custom = getModelParameterSpec('google', 'gemini-9-experimental');

		expect(controlByKey(flash, 'reasoningEffort')).toMatchObject({
			options: ['off', 'minimal', 'low', 'medium', 'high'],
		});
		expect(controlByKey(custom, 'reasoningEffort')).toMatchObject({ options: ['off', 'low', 'high'] });
	});

	it('marks integer-only params and leaves float params unmarked', () => {
		const controls = getModelParameterSpec('anthropic', 'claude-sonnet-4-5');

		expect(controlByKey(controls, 'thinkingBudgetTokens')).toMatchObject({ integer: true });
		expect(controlByKey(controls, 'topK')).toMatchObject({ integer: true });
		expect(controlByKey(controls, 'maxOutputTokens')).toMatchObject({ integer: true });
		expect(controlByKey(controls, 'temperature')).not.toHaveProperty('integer');
		expect(controlByKey(controls, 'topP')).not.toHaveProperty('integer');
	});

	it('applies the Claude sampling rules to Claude on Bedrock', () => {
		const controls = getModelParameterSpec('bedrock', 'us.anthropic.claude-sonnet-4-6');

		expect(controlByKey(controls, 'temperature')).toMatchObject({ max: 1, group: 'sampling' });
		expect(controlByKey(controls, 'topP')).toMatchObject({ exclusiveWith: 'temperature' });
	});

	it('uses the provider-specific service tier vocabulary', () => {
		const bedrock = getModelParameterSpec('bedrock', 'us.anthropic.claude-sonnet-4-6');
		const google = getModelParameterSpec('google', 'gemini-3.1-pro-preview');

		expect(controlByKey(bedrock, 'serviceTier')).toMatchObject({
			kind: 'select',
			options: ['default', 'reserved', 'priority', 'flex'],
		});
		expect(controlByKey(google, 'serviceTier')).toMatchObject({
			kind: 'select',
			options: ['standard', 'flex', 'priority'],
		});
	});

	it('derives the Gemini safety and media select options from their schemas', () => {
		const controls = getModelParameterSpec('google', 'gemini-3.1-pro-preview');

		expect(controlByKey(controls, 'safetyThreshold')).toMatchObject({
			kind: 'select',
			options: [
				'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
				'BLOCK_LOW_AND_ABOVE',
				'BLOCK_MEDIUM_AND_ABOVE',
				'BLOCK_ONLY_HIGH',
				'BLOCK_NONE',
				'OFF',
			],
		});
		expect(controlByKey(controls, 'mediaResolution')).toMatchObject({
			kind: 'select',
			options: [
				'MEDIA_RESOLUTION_UNSPECIFIED',
				'MEDIA_RESOLUTION_LOW',
				'MEDIA_RESOLUTION_MEDIUM',
				'MEDIA_RESOLUTION_HIGH',
			],
		});
	});

	it('derives boolean and number controls for the Mistral extras', () => {
		const controls = getModelParameterSpec('mistral', 'mistral-medium-latest');

		expect(controls.map((c) => c.key)).toEqual([
			'temperature',
			'topP',
			'maxOutputTokens',
			'safePrompt',
			'parallelToolCalls',
			'documentImageLimit',
			'documentPageLimit',
		]);
		expect(controlByKey(controls, 'safePrompt')).toMatchObject({ kind: 'boolean' });
		expect(controlByKey(controls, 'parallelToolCalls')).toMatchObject({ kind: 'boolean' });
		expect(controlByKey(controls, 'documentImageLimit')).toMatchObject({ kind: 'number', min: 1 });
		expect(controlByKey(controls, 'documentPageLimit')).toMatchObject({ kind: 'number', min: 1 });
	});

	it('derives the temperature bound from each model capability', () => {
		const mistral = getModelParameterSpec('mistral', 'mistral-medium-latest');
		const bedrockDeepseek = getModelParameterSpec('bedrock', 'deepseek.v3.2');
		const gemini = getModelParameterSpec('google', 'gemini-3.1-pro-preview');

		expect(controlByKey(mistral, 'temperature')).toMatchObject({ max: 1.5, placeholder: '0 – 1.5' });
		expect(controlByKey(bedrockDeepseek, 'temperature')).toMatchObject({ max: 1 });
		expect(controlByKey(gemini, 'temperature')).toMatchObject({ max: 2 });
	});
});

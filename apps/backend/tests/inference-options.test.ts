import type { LlmProvider } from '@nao/shared/types';
import { describe, expect, it } from 'vitest';

import { createProviderModel, fitThinkingBudget } from '../src/agents/providers';
import type { ModelInferenceSettings, ProviderSettings } from '../src/types/llm';

const SETTINGS: ProviderSettings = { apiKey: 'test-key' };
const VERTEX_SETTINGS: ProviderSettings = {
	apiKey: '',
	credentials: { project: 'test-project', location: 'us-east5' },
};

function resolve(provider: LlmProvider, modelId: string, inference?: ModelInferenceSettings) {
	const settings = provider === 'vertex' ? VERTEX_SETTINGS : SETTINGS;
	const result = createProviderModel(provider, settings, modelId, inference);
	const optionKey = provider === 'vertex' && modelId.startsWith('claude-') ? 'anthropic' : provider;
	const options = (result.providerOptions[optionKey] ?? {}) as Record<string, unknown>;
	return { callSettings: result.callSettings, options, providerOptions: result.providerOptions };
}

describe('Anthropic (live-validated Claude rules)', () => {
	it('returns no call settings and no thinking overrides without inference settings', () => {
		const { callSettings, options } = resolve('anthropic', 'claude-sonnet-4-6');

		expect(callSettings).toBeUndefined();
		expect(options).not.toHaveProperty('thinking');
		expect(options).not.toHaveProperty('effort');
	});

	it('sends adaptive thinking as { thinking: adaptive, effort }', () => {
		const { options } = resolve('anthropic', 'claude-sonnet-4-6', { reasoningEffort: 'high' });

		expect(options.thinking).toEqual({ type: 'adaptive' });
		expect(options.effort).toBe('high');
	});

	it('sends budget thinking as { thinking: enabled, budgetTokens }', () => {
		const { options } = resolve('anthropic', 'claude-sonnet-4-5', { thinkingBudgetTokens: 8192 });

		expect(options.thinking).toEqual({ type: 'enabled', budgetTokens: 8192 });
		expect(options).not.toHaveProperty('effort');
	});

	it('disables thinking when reasoningEffort is off', () => {
		const { callSettings, options } = resolve('anthropic', 'claude-sonnet-4-6', {
			reasoningEffort: 'off',
			temperature: 0.5,
		});

		expect(options).not.toHaveProperty('thinking');
		expect(callSettings).toEqual({ temperature: 0.5 });
	});

	it('drops sampling params while adaptive thinking is active', () => {
		const { callSettings } = resolve('anthropic', 'claude-sonnet-4-6', {
			reasoningEffort: 'medium',
			temperature: 0.7,
			topP: 0.9,
			topK: 40,
			maxOutputTokens: 4096,
		});

		expect(callSettings).toEqual({ maxOutputTokens: 4096 });
	});

	it('drops sampling params while budget thinking is active', () => {
		const { callSettings } = resolve('anthropic', 'claude-sonnet-4-5', {
			thinkingBudgetTokens: 2048,
			temperature: 0.7,
			topP: 0.9,
		});

		expect(callSettings).toBeUndefined();
	});

	it('keeps sampling on a budget model when no budget is set', () => {
		const { callSettings, options } = resolve('anthropic', 'claude-sonnet-4-5', { temperature: 0.4 });

		expect(options).not.toHaveProperty('thinking');
		expect(callSettings).toEqual({ temperature: 0.4 });
	});

	it('drops topP when temperature is also set', () => {
		const { callSettings } = resolve('anthropic', 'claude-sonnet-4-6', { temperature: 0.7, topP: 0.9 });

		expect(callSettings).toEqual({ temperature: 0.7 });
	});

	it('keeps topP when set alone', () => {
		const { callSettings } = resolve('anthropic', 'claude-sonnet-4-6', { topP: 0.9 });

		expect(callSettings).toEqual({ topP: 0.9 });
	});

	it('only sends topK when the model declares support', () => {
		const withoutTopK = resolve('anthropic', 'claude-sonnet-4-6', { topK: 40 });
		const withTopK = resolve('anthropic', 'claude-sonnet-4-5', { topK: 40 });

		expect(withoutTopK.callSettings).toBeUndefined();
		expect(withTopK.callSettings).toEqual({ topK: 40 });
	});

	it('applies maxOutputTokens when the capability allows it', () => {
		const { callSettings } = resolve('anthropic', 'claude-sonnet-4-6', { maxOutputTokens: 16_000 });

		expect(callSettings).toEqual({ maxOutputTokens: 16_000 });
	});

	it('preserves default provider options alongside thinking overrides', () => {
		const { options } = resolve('anthropic', 'claude-sonnet-4-6', { reasoningEffort: 'low' });

		expect(options.disableParallelToolUse).toBe(false);
		expect(options).toHaveProperty('contextManagement');
	});

	it('clamps a stale minimal effort to low (not in the Claude vocabulary)', () => {
		const { options } = resolve('anthropic', 'claude-sonnet-4-6', { reasoningEffort: 'minimal' });

		expect(options.thinking).toEqual({ type: 'adaptive' });
		expect(options.effort).toBe('low');
	});
});

describe('OpenAI / Azure', () => {
	it('translates effort to reasoningEffort for reasoning models', () => {
		const { options } = resolve('openai', 'gpt-5.5', { reasoningEffort: 'high' });

		expect(options.reasoningEffort).toBe('high');
	});

	it('clamps a stale max effort to high on listed models that lack xhigh', () => {
		const { options } = resolve('openai', 'gpt-5.5', { reasoningEffort: 'max' });

		expect(options.reasoningEffort).toBe('high');
	});

	it('translates max to xhigh for custom models with the full effort surface', () => {
		const { options } = resolve('openai', 'gpt-6-codex-max', { reasoningEffort: 'max' });

		expect(options.reasoningEffort).toBe('xhigh');
	});

	it('skips sampling params when the model does not support sampling', () => {
		const { callSettings } = resolve('openai', 'gpt-5.5', {
			reasoningEffort: 'high',
			temperature: 1.2,
			topP: 0.8,
			maxOutputTokens: 2000,
		});

		expect(callSettings).toEqual({ maxOutputTokens: 2000 });
	});

	it('keeps temperature and topP together for non-reasoning models', () => {
		const { callSettings, options } = resolve('openai', 'gpt-4.1', {
			reasoningEffort: 'high',
			temperature: 1.5,
			topP: 0.8,
		});

		expect(options).not.toHaveProperty('reasoningEffort');
		expect(callSettings).toEqual({ temperature: 1.5, topP: 0.8 });
	});

	it('offers both effort and sampling for custom Azure deployments', () => {
		const { options, callSettings } = resolve('azure', 'my-gpt-deployment', {
			reasoningEffort: 'low',
			temperature: 0.9,
		});

		expect(options.reasoningEffort).toBe('low');
		expect(callSettings).toEqual({ temperature: 0.9 });
	});
});

describe('Google Gemini', () => {
	it('translates effort to a thinking level and keeps sampling', () => {
		const { options, callSettings } = resolve('google', 'gemini-3.1-pro-preview', {
			reasoningEffort: 'max',
			temperature: 1.4,
			topK: 40,
		});

		expect(options.thinkingConfig).toEqual({ thinkingLevel: 'high' });
		expect(callSettings).toEqual({ temperature: 1.4, topK: 40 });
	});

	it('clamps a stale minimal effort to low on models that reject MINIMAL', () => {
		const { options } = resolve('google', 'gemini-3.1-pro-preview', { reasoningEffort: 'minimal' });

		expect(options.thinkingConfig).toEqual({ thinkingLevel: 'low' });
	});

	it('keeps minimal on models that support it', () => {
		const { options } = resolve('google', 'gemini-3-flash-preview', { reasoningEffort: 'minimal' });

		expect(options.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
	});

	it('clamps custom models to the low/high levels every Gemini accepts', () => {
		const minimal = resolve('google', 'gemini-9-experimental', { reasoningEffort: 'minimal' });
		const medium = resolve('google', 'gemini-9-experimental', { reasoningEffort: 'medium' });

		expect(minimal.options.thinkingConfig).toEqual({ thinkingLevel: 'low' });
		expect(medium.options.thinkingConfig).toEqual({ thinkingLevel: 'low' });
	});

	it('sends nothing when effort is off', () => {
		const { options } = resolve('google', 'gemini-3.1-pro-preview', { reasoningEffort: 'off' });

		expect(options).not.toHaveProperty('thinkingConfig');
	});

	it('translates a token budget to thinkingConfig.thinkingBudget', () => {
		const { options } = resolve('google', 'gemini-2.5-pro', { thinkingBudgetTokens: 2048 });

		expect(options.thinkingConfig).toEqual({ thinkingBudget: 2048 });
	});

	it('never sends a thinking level to budget-based Gemini 2.5 models', () => {
		const { options } = resolve('google', 'gemini-2.5-flash', { reasoningEffort: 'minimal' });

		expect(options).not.toHaveProperty('thinkingConfig');
	});
});

describe('Bedrock', () => {
	it('sends adaptive reasoningConfig for Claude and drops sampling', () => {
		const { options, callSettings } = resolve('bedrock', 'us.anthropic.claude-sonnet-4-6', {
			reasoningEffort: 'max',
			temperature: 0.5,
		});

		expect(options.reasoningConfig).toEqual({ type: 'adaptive', maxReasoningEffort: 'max' });
		expect(callSettings).toBeUndefined();
	});

	it('sends budget reasoningConfig for custom Claude model ids', () => {
		const { options } = resolve('bedrock', 'anthropic.claude-3-7-sonnet', { thinkingBudgetTokens: 4096 });

		expect(options.reasoningConfig).toEqual({ type: 'enabled', budgetTokens: 4096 });
	});

	it('keeps sampling and skips reasoning for non-Claude models', () => {
		const { options, callSettings } = resolve('bedrock', 'deepseek.v3.2', {
			reasoningEffort: 'high',
			temperature: 0.9,
		});

		expect(options).not.toHaveProperty('reasoningConfig');
		expect(callSettings).toEqual({ temperature: 0.9 });
	});
});

describe('OpenRouter', () => {
	it('translates effort to the reasoning option', () => {
		const { options } = resolve('openrouter', 'moonshotai/kimi-k2.5', { reasoningEffort: 'medium' });

		expect(options.reasoning).toEqual({ enabled: true, effort: 'medium' });
	});

	it('translates max to xhigh without clamping (no restricted effort options)', () => {
		const { options } = resolve('openrouter', 'moonshotai/kimi-k2.5', { reasoningEffort: 'max' });

		expect(options.reasoning).toEqual({ enabled: true, effort: 'xhigh' });
	});
});

describe('Vertex', () => {
	it('applies the Claude rules and keys options under anthropic', () => {
		const { options, providerOptions, callSettings } = resolve('vertex', 'claude-sonnet-4-6', {
			reasoningEffort: 'high',
			topP: 0.9,
		});

		expect(providerOptions).not.toHaveProperty('vertex');
		expect(options.thinking).toEqual({ type: 'adaptive' });
		expect(options.effort).toBe('high');
		expect(callSettings).toBeUndefined();
	});

	it('applies the Gemini rules and keys options under vertex', () => {
		const { options, providerOptions } = resolve('vertex', 'gemini-3-flash-preview', { reasoningEffort: 'low' });

		expect(providerOptions).not.toHaveProperty('anthropic');
		expect(options.thinkingConfig).toEqual({ thinkingLevel: 'low' });
	});
});

describe('Mistral and Ollama', () => {
	it('passes sampling and maxOutputTokens through for Mistral', () => {
		const { callSettings } = resolve('mistral', 'mistral-medium-latest', {
			temperature: 0.3,
			maxOutputTokens: 1000,
		});

		expect(callSettings).toEqual({ temperature: 0.3, maxOutputTokens: 1000 });
	});

	it('passes sampling including topK through for Ollama', () => {
		const { callSettings } = resolve('ollama', 'qwen3:8b', { temperature: 0.5, topK: 20 });

		expect(callSettings).toEqual({ temperature: 0.5, topK: 20 });
	});
});

describe('sampling bound clamps (stored values must never fail a request)', () => {
	it('clamps a stored temperature above 1 to 1 for Claude', () => {
		const { callSettings } = resolve('anthropic', 'claude-sonnet-4-6', { temperature: 1.5 });

		expect(callSettings).toEqual({ temperature: 1 });
	});

	it('clamps temperature to 1.5 for Mistral', () => {
		const { callSettings } = resolve('mistral', 'mistral-medium-latest', { temperature: 1.8 });

		expect(callSettings).toEqual({ temperature: 1.5 });
	});

	it('passes a high temperature through for models with the default 0-2 range', () => {
		const openai = resolve('openai', 'gpt-4.1', { temperature: 1.8 });
		const gemini = resolve('google', 'gemini-3.1-pro-preview', { temperature: 1.8 });

		expect(openai.callSettings).toEqual({ temperature: 1.8 });
		expect(gemini.callSettings).toEqual({ temperature: 1.8 });
	});

	it('clamps temperature to 1 for Claude on Vertex and all Bedrock models', () => {
		const vertexClaude = resolve('vertex', 'claude-sonnet-4-6', { temperature: 1.5 });
		const bedrockClaude = resolve('bedrock', 'us.anthropic.claude-sonnet-4-6', { temperature: 1.5 });
		const bedrockDeepseek = resolve('bedrock', 'deepseek.v3.2', { temperature: 1.5 });

		expect(vertexClaude.callSettings).toEqual({ temperature: 1 });
		expect(bedrockClaude.callSettings).toEqual({ temperature: 1 });
		expect(bedrockDeepseek.callSettings).toEqual({ temperature: 1 });
	});

	it('clamps topP to the 0-1 range', () => {
		const above = resolve('openai', 'gpt-4.1', { topP: 1.2 });
		const below = resolve('openai', 'gpt-4.1', { topP: -0.1 });

		expect(above.callSettings).toEqual({ topP: 1 });
		expect(below.callSettings).toEqual({ topP: 0 });
	});

	it('clamps a negative temperature to 0', () => {
		const { callSettings } = resolve('google', 'gemini-3.1-pro-preview', { temperature: -1 });

		expect(callSettings).toEqual({ temperature: 0 });
	});
});

describe('thinking budget safety (stored budgets must never fail a request)', () => {
	it('clamps a Claude budget to fit under the physical output cap with headroom', () => {
		const { options } = resolve('anthropic', 'claude-sonnet-4-5', { thinkingBudgetTokens: 100_000 });

		expect(options.thinking).toEqual({ type: 'enabled', budgetTokens: 62_976 });
	});

	it('keeps a Claude budget that already fits', () => {
		const { options } = resolve('anthropic', 'claude-sonnet-4-5', { thinkingBudgetTokens: 8192 });

		expect(options.thinking).toEqual({ type: 'enabled', budgetTokens: 8192 });
	});

	it('clamps a Bedrock Claude budget the same way', () => {
		const { options } = resolve('bedrock', 'anthropic.claude-3-7-sonnet', { thinkingBudgetTokens: 100_000 });

		expect(options.reasoningConfig).toEqual({ type: 'enabled', budgetTokens: 62_976 });
	});

	it('clamps the Gemini 2.5 Pro thinking budget at both ends of the API range', () => {
		const low = resolve('google', 'gemini-2.5-pro', { thinkingBudgetTokens: 64 });
		const high = resolve('google', 'gemini-2.5-pro', { thinkingBudgetTokens: 100_000 });

		expect(low.options.thinkingConfig).toEqual({ thinkingBudget: 128 });
		expect(high.options.thinkingConfig).toEqual({ thinkingBudget: 32_768 });
	});

	it('clamps the Gemini 2.5 Flash thinking budget to its own range', () => {
		const { options } = resolve('google', 'gemini-2.5-flash', { thinkingBudgetTokens: 100_000 });

		expect(options.thinkingConfig).toEqual({ thinkingBudget: 24_576 });
	});
});

describe('fitThinkingBudget (per-call refit where call sites override maxOutputTokens)', () => {
	it('clamps a huge stored Claude budget under an internal call cap', () => {
		const { providerOptions } = createProviderModel('anthropic', SETTINGS, 'claude-sonnet-4-5', {
			thinkingBudgetTokens: 32_000,
		});

		const fitted = fitThinkingBudget(providerOptions, 4000);

		expect(fitted.anthropic?.thinking).toEqual({ type: 'enabled', budgetTokens: 2976 });
	});

	it('drops thinking entirely when the budget cannot fit above the 1024 floor', () => {
		const { providerOptions } = createProviderModel('anthropic', SETTINGS, 'claude-sonnet-4-5', {
			thinkingBudgetTokens: 32_000,
		});

		const fitted = fitThinkingBudget(providerOptions, 2000);

		expect(fitted.anthropic).not.toHaveProperty('thinking');
		expect(fitted.anthropic).toHaveProperty('contextManagement');
	});

	it('refits the Bedrock reasoningConfig the same way', () => {
		const { providerOptions } = createProviderModel('bedrock', SETTINGS, 'anthropic.claude-3-7-sonnet', {
			thinkingBudgetTokens: 32_000,
			serviceTier: 'flex',
		});

		const clamped = fitThinkingBudget(providerOptions, 16_000);
		const dropped = fitThinkingBudget(providerOptions, 2000);

		expect(clamped.bedrock?.reasoningConfig).toEqual({ type: 'enabled', budgetTokens: 14_976 });
		expect(dropped.bedrock).not.toHaveProperty('reasoningConfig');
		expect(dropped.bedrock?.serviceTier).toBe('flex');
	});

	it('keeps a budget that already fits and leaves adaptive thinking untouched', () => {
		const budget = createProviderModel('anthropic', SETTINGS, 'claude-sonnet-4-5', {
			thinkingBudgetTokens: 8192,
		});
		const adaptive = createProviderModel('anthropic', SETTINGS, 'claude-sonnet-4-6', {
			reasoningEffort: 'high',
		});

		expect(fitThinkingBudget(budget.providerOptions, 16_000).anthropic?.thinking).toEqual({
			type: 'enabled',
			budgetTokens: 8192,
		});
		expect(fitThinkingBudget(adaptive.providerOptions, 4000).anthropic?.thinking).toEqual({ type: 'adaptive' });
	});
});

describe('extra provider options', () => {
	it('inverts parallelToolCalls into disableParallelToolUse for Anthropic', () => {
		const enabled = resolve('anthropic', 'claude-sonnet-4-6', { parallelToolCalls: true });
		const disabled = resolve('anthropic', 'claude-sonnet-4-6', { parallelToolCalls: false });

		expect(enabled.options.disableParallelToolUse).toBe(false);
		expect(disabled.options.disableParallelToolUse).toBe(true);
		expect(enabled.options).not.toHaveProperty('parallelToolCalls');
	});

	it('passes the Anthropic-specific extras through unchanged', () => {
		const { options } = resolve('anthropic', 'claude-sonnet-4-6', {
			speed: 'fast',
			inferenceGeo: 'us',
			sendReasoning: false,
		});

		expect(options.speed).toBe('fast');
		expect(options.inferenceGeo).toBe('us');
		expect(options.sendReasoning).toBe(false);
	});

	it('never leaks stale extras to a model that does not declare them', () => {
		const claude = resolve('anthropic', 'claude-sonnet-4-6', {
			textVerbosity: 'low',
			safetyThreshold: 'BLOCK_NONE',
			safePrompt: true,
			serviceTier: 'flex',
		});
		const openai = resolve('openai', 'gpt-5.5', { speed: 'fast', includeThoughts: true, safePrompt: true });
		const openrouter = resolve('openrouter', 'moonshotai/kimi-k2.5', { serviceTier: 'flex', speed: 'fast' });
		const ollama = resolve('ollama', 'qwen3:8b', { serviceTier: 'flex', textVerbosity: 'high' });

		for (const key of ['textVerbosity', 'threshold', 'safetyThreshold', 'safePrompt', 'serviceTier']) {
			expect(claude.options).not.toHaveProperty(key);
		}
		for (const key of ['speed', 'includeThoughts', 'thinkingConfig', 'safePrompt']) {
			expect(openai.options).not.toHaveProperty(key);
		}
		for (const key of ['serviceTier', 'speed']) {
			expect(openrouter.options).not.toHaveProperty(key);
			expect(ollama.options).not.toHaveProperty(key);
		}
	});

	it('passes the OpenAI extras through without inversion', () => {
		const { options } = resolve('openai', 'gpt-5.5', {
			textVerbosity: 'low',
			reasoningSummary: 'detailed',
			parallelToolCalls: false,
			maxToolCalls: 5,
			serviceTier: 'flex',
		});

		expect(options.textVerbosity).toBe('low');
		expect(options.reasoningSummary).toBe('detailed');
		expect(options.parallelToolCalls).toBe(false);
		expect(options.maxToolCalls).toBe(5);
		expect(options.serviceTier).toBe('flex');
		expect(options).not.toHaveProperty('disableParallelToolUse');
	});

	it('maps the Gemini extras onto their provider option names', () => {
		const { options } = resolve('google', 'gemini-3.1-pro-preview', {
			safetyThreshold: 'BLOCK_NONE',
			mediaResolution: 'MEDIA_RESOLUTION_HIGH',
			serviceTier: 'priority',
		});

		expect(options.threshold).toBe('BLOCK_NONE');
		expect(options).not.toHaveProperty('safetyThreshold');
		expect(options.mediaResolution).toBe('MEDIA_RESOLUTION_HIGH');
		expect(options.serviceTier).toBe('priority');
	});

	it('nests includeThoughts under thinkingConfig when set alone', () => {
		const { options } = resolve('google', 'gemini-3.1-pro-preview', { includeThoughts: true });

		expect(options.thinkingConfig).toEqual({ includeThoughts: true });
	});

	it('deep-merges includeThoughts with an active thinking level', () => {
		const { options } = resolve('google', 'gemini-3.1-pro-preview', {
			reasoningEffort: 'high',
			includeThoughts: true,
		});

		expect(options.thinkingConfig).toEqual({ thinkingLevel: 'high', includeThoughts: true });
	});

	it('deep-merges includeThoughts with an active thinking budget', () => {
		const { options } = resolve('google', 'gemini-2.5-pro', {
			thinkingBudgetTokens: 2048,
			includeThoughts: true,
		});

		expect(options.thinkingConfig).toEqual({ thinkingBudget: 2048, includeThoughts: true });
	});

	it('passes the Mistral extras through unchanged', () => {
		const { options } = resolve('mistral', 'mistral-medium-latest', {
			safePrompt: true,
			parallelToolCalls: false,
			documentImageLimit: 8,
			documentPageLimit: 64,
		});

		expect(options.safePrompt).toBe(true);
		expect(options.parallelToolCalls).toBe(false);
		expect(options).not.toHaveProperty('disableParallelToolUse');
		expect(options.documentImageLimit).toBe(8);
		expect(options.documentPageLimit).toBe(64);
	});

	it('sends serviceTier for Bedrock models but ignores undeclared extras', () => {
		const claude = resolve('bedrock', 'us.anthropic.claude-sonnet-4-6', {
			serviceTier: 'reserved',
			parallelToolCalls: false,
		});
		const deepseek = resolve('bedrock', 'deepseek.v3.2', { serviceTier: 'flex' });

		expect(claude.options.serviceTier).toBe('reserved');
		expect(claude.options).not.toHaveProperty('disableParallelToolUse');
		expect(deepseek.options.serviceTier).toBe('flex');
	});

	it('applies the Anthropic inversion to Claude on Vertex', () => {
		const { options } = resolve('vertex', 'claude-sonnet-4-6', { parallelToolCalls: false });

		expect(options.disableParallelToolUse).toBe(true);
		expect(options).not.toHaveProperty('parallelToolCalls');
	});
});

import type { AiHarness } from '../types/agent-settings';
import type { LlmProvider } from '../types/llm';
import { PROVIDER_META } from './provider-meta';

export interface HarnessConfig {
	label: string;
	description: string;
	provider: LlmProvider;
	modelId: string;
	modelName: string;
}

const HARNESS_CONFIGS: Record<Exclude<AiHarness, 'default'>, HarnessConfig> = {
	anthropic: {
		label: 'Claude',
		description: 'Anthropic Claude — optimised for analytics with extended thinking and prompt caching.',
		provider: 'anthropic',
		modelId: getDefaultModel('anthropic'),
		modelName: getDefaultModelName('anthropic'),
	},
	openai: {
		label: 'Codex',
		description: 'OpenAI Codex — optimised for analytics with the Responses API.',
		provider: 'openai',
		modelId: getDefaultModel('openai'),
		modelName: getDefaultModelName('openai'),
	},
};

export function getHarnessConfig(harness: AiHarness): HarnessConfig | null {
	if (harness === 'default') {
		return null;
	}
	return HARNESS_CONFIGS[harness];
}

export function getAvailableHarnesses(): Array<{ id: AiHarness; label: string; description: string }> {
	return [
		{ id: 'default', label: 'Default', description: 'Use any configured provider — select the model per message.' },
		...Object.entries(HARNESS_CONFIGS).map(([id, config]) => ({
			id: id as AiHarness,
			label: config.label,
			description: config.description,
		})),
	];
}

function getDefaultModel(provider: LlmProvider): string {
	const models = PROVIDER_META[provider].models;
	return models.find((m) => m.default)?.id ?? models[0].id;
}

function getDefaultModelName(provider: LlmProvider): string {
	const models = PROVIDER_META[provider].models;
	const model = models.find((m) => m.default) ?? models[0];
	return model.name;
}

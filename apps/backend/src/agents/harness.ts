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
		label: 'Claude Code',
		description:
			'Uses the Claude Code SDK (ai-sdk-provider-claude-code). Requires the Claude CLI installed and a Pro/Max subscription.',
		provider: 'claude-code',
		modelId: getDefaultModel('claude-code'),
		modelName: getDefaultModelName('claude-code'),
	},
	openai: {
		label: 'Codex',
		description:
			'Uses the Codex CLI SDK (ai-sdk-provider-codex-cli). Requires the Codex CLI installed and a ChatGPT Plus/Pro subscription.',
		provider: 'codex',
		modelId: getDefaultModel('codex'),
		modelName: getDefaultModelName('codex'),
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

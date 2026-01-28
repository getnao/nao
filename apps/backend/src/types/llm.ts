import { z } from 'zod';

export const llmProviderSchema = z.enum(['openai', 'anthropic']);
export type LlmProvider = z.infer<typeof llmProviderSchema>;

export const llmConfigSchema = z.object({
	id: z.string(),
	provider: llmProviderSchema,
	apiKeyPreview: z.string().nullable(),
	enabledModels: z.array(z.string()).nullable(),
	baseUrl: z.string().url().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

/** Provider configuration with env var names and known models */
export const LLM_PROVIDERS: Record<
	LlmProvider,
	{
		envVar: string;
		models: readonly { id: string; name: string; default?: boolean }[];
	}
> = {
	anthropic: {
		envVar: 'ANTHROPIC_API_KEY',
		models: [
			{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', default: true },
			{ id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
			{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
		],
	},
	openai: {
		envVar: 'OPENAI_API_KEY',
		models: [
			{ id: 'gpt-5.2', name: 'GPT 5.2', default: true },
			{ id: 'gpt-5-mini', name: 'GPT 5 mini' },
			{ id: 'gpt-4.1', name: 'GPT 4.1' },
		],
	},
};

/** Known models for each provider (legacy format for API compatibility) */
export const KNOWN_MODELS = Object.fromEntries(
	Object.entries(LLM_PROVIDERS).map(([provider, config]) => [provider, config.models]),
) as { [K in LlmProvider]: (typeof LLM_PROVIDERS)[K]['models'] };

export function getDefaultModelId(provider: LlmProvider): string {
	const models = LLM_PROVIDERS[provider].models;
	const defaultModel = models.find((m) => m.default);
	return defaultModel?.id ?? models[0].id;
}

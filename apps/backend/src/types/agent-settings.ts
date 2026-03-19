export type WebSearchMode = 'provider';

export const AI_HARNESSES = ['default', 'anthropic', 'openai'] as const;
export type AiHarness = (typeof AI_HARNESSES)[number];

export interface AgentSettings {
	memoryEnabled?: boolean;
	harness?: AiHarness;
	experimental?: {
		pythonSandboxing?: boolean;
		sandboxes?: boolean;
	};
	transcribe?: {
		enabled?: boolean;
		provider?: string;
		modelId?: string;
	};
	sql?: {
		dangerouslyWritePermEnabled?: boolean;
	};
	webSearch?: {
		enabled?: boolean;
		mode?: WebSearchMode;
	};
}

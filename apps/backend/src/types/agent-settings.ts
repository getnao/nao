export type WebSearchMode = 'provider';

export interface AgentSettings {
	memoryEnabled?: boolean;
	llm?: {
		/** Per-model max output tokens keyed by "provider:modelId". */
		maxOutputTokensByProviderModel?: Record<string, number>;
	};
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

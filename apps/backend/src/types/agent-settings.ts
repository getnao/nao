export type WebSearchMode = 'provider';

export interface AgentSettings {
	memoryEnabled?: boolean;
	experimental?: {
		pythonSandboxing?: boolean;
		sandboxes?: boolean;
		displayMap?: boolean;
	};
	transcribe?: {
		enabled?: boolean;
		provider?: string;
		modelId?: string;
	};
	sql?: {
		dangerouslyWritePermEnabled?: boolean;
	};
	pythonExecution?: {
		maxDurationSecs?: number;
	};
	webSearch?: {
		enabled?: boolean;
		mode?: WebSearchMode;
	};
}

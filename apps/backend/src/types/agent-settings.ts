export type WebSearchMode = 'provider';

export interface AgentSettings {
	memoryEnabled?: boolean;
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
	powerbi?: {
		/** Enable the execute_dax tool for Power BI Semantic Models via XMLA. */
		xmlaEnabled?: boolean;
	};
}

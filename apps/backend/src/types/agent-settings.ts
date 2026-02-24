export interface AgentSettings {
	memoryEnabled?: boolean;
	experimental?: {
		pythonSandboxing?: boolean;
		/** Approximate token threshold (chars/4) at which conversation compaction is triggered. */
		conversationCompactionThresholdTokens?: number;
	};
	transcribe?: {
		enabled?: boolean;
		provider?: string;
		modelId?: string;
	};
}

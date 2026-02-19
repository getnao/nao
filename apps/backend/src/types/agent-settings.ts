export interface AgentSettings {
	experimental?: {
		pythonSandboxing?: boolean;
		/** Approximate token threshold (chars/4) at which conversation compaction is triggered. */
		conversationCompactionThresholdTokens?: number;
	};
}

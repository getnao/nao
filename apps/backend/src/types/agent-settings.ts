import type { LlmSelectedModel, SemanticLayerMode } from '@nao/shared/types';

export type WebSearchMode = 'provider';

export interface AgentSettings {
	memoryEnabled?: boolean;
	mapEnabled?: boolean;
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
		enforceExcludedColumns?: boolean;
	};
	pythonExecution?: {
		maxDurationSecs?: number;
	};
	webSearch?: {
		enabled?: boolean;
		mode?: WebSearchMode;
	};
	semanticLayer?: {
		mode?: SemanticLayerMode;
	};
	subagent?: {
		/** Model subagents run on; null or absent means the model of the chat that spawned them. */
		model?: LlmSelectedModel | null;
	};
}

import type { LlmProvider } from '@nao/shared/types';

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
	liveStoryRefresh?: {
		provider: LlmProvider;
		modelId: string;
	} | null;
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

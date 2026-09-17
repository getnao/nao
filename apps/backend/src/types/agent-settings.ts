import type { StoryStyle } from '@nao/shared/dbt-charts';
import type { SemanticLayerMode } from '@nao/shared/types';

export type WebSearchMode = 'provider';

export interface AgentSettings {
	memoryEnabled?: boolean;
	mapEnabled?: boolean;
	stories?: {
		style?: StoryStyle;
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
}

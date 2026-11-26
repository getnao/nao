import type { SqlQueryTagConfig } from '@nao/shared/sql-query-tag';
import type { LlmSelectedModel, SemanticLayerMode } from '@nao/shared/types';

import type { DecisionModel } from './decision';

export type WebSearchMode = 'provider';

export interface AgentSettings {
	memoryEnabled?: boolean;
	mapEnabled?: boolean;
	requireConversationFeedback?: boolean;
	experimental?: {
		codemode?: boolean;
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
		/** Ignored when nao_config.yaml declares a `query_tag`, which wins over the admin settings. */
		queryTag?: SqlQueryTagConfig & { enabled: boolean };
	};
	webSearch?: {
		enabled?: boolean;
		mode?: WebSearchMode;
	};
	semanticLayer?: {
		mode?: SemanticLayerMode;
	};
	/** Model decisions run on; absent means the first model of a connected provider. */
	decision?: DecisionModel;
	subagent?: {
		/** Model subagents run on; null or absent means the model of the chat that spawned them. */
		model?: LlmSelectedModel | null;
	};
}

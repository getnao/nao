import { AgentSettings } from './agent-settings';

export interface QueryResult {
	columns: string[];
	data: Record<string, unknown>[];
}

export interface ToolContext {
	projectFolder: string;
	chatId: string;
	agentSettings: AgentSettings | null;
	/** Mutable store for query results shared across tool calls within a single agent run. */
	queryResults: Map<string, QueryResult>;
}

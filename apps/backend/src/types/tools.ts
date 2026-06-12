import type { displayChart } from '@nao/shared/tools';

import { AgentSettings } from './agent-settings';

export interface QueryResult {
	columns: string[];
	data: Record<string, unknown>[];
}

export interface GeneratedArtifacts {
	charts: displayChart.Input[];
	stories: { id: string; title: string }[];
}

export interface ToolContext {
	projectFolder: string;
	chatId: string;
	userId: string;
	projectId: string;
	agentSettings: AgentSettings | null;
	envVars: Record<string, string>;
	/**
	 * Database federation access token. Populated by the EE Microsoft/Azure AD
	 * integration when the user signs in via Microsoft; always null in the
	 * open-source edition.
	 */
	azureAccessToken: string | null;
	/**
	 * In-memory cache for query results within a single agent run.
	 * For queries from earlier turns in the same chat, prefer
	 * `services/query-result.service#getQueryResult`, which falls back
	 * to message history and caches the result back into this map.
	 */
	queryResults: Map<string, QueryResult>;
	generatedArtifacts: GeneratedArtifacts;
}

export type McpToolContext = Omit<ToolContext, 'chatId'> & { chatId: null };

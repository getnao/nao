import type { UserGroupFeature } from '@nao/shared';
import type { UserRulesGroupAccess } from '@nao/shared/rules-template';
import type { displayChart, displayMap } from '@nao/shared/tools';

import type { WarehouseTableAccess } from '../services/context-access';
import type { ResolvedDocsContextAccess } from '../services/user-group-context-access.service';
import { AgentSettings } from './agent-settings';

export interface QueryResult {
	columns: string[];
	data: Record<string, unknown>[];
}

export interface GeneratedArtifacts {
	charts: (displayChart.BuiltinChartInput | displayChart.KpiCardInput)[];
	maps: displayMap.Input[];
	stories: { id: string; title: string }[];
}

export interface ToolContext {
	projectFolder: string;
	chatId: string;
	userId: string;
	projectId: string;
	storyCreationEnabled?: boolean;
	supportsCustomCharts: boolean;
	agentSettings: AgentSettings | null;
	envVars: Record<string, string>;
	warehouseTableAccess: WarehouseTableAccess;
	docsContextAccess: ResolvedDocsContextAccess;
	userGroupFeatures: UserGroupFeature[];
	userRulesGroupAccess: UserRulesGroupAccess;
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
	/**
	 * Admin mode: when true, `execute_sql` runs read-only SQL over nao's own
	 * project-scoped app-database views instead of the user's warehouse.
	 */
	adminMode?: boolean;
}

export type McpToolContext = Omit<ToolContext, 'chatId'> & { chatId: null };

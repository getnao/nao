import type { McpAccess, UserGroupFeature, WarehouseRowSecurity } from '@nao/shared';
import type { UserRulesGroupAccess } from '@nao/shared/rules-template';
import type { displayChart, displayMap, executeSemanticQuery } from '@nao/shared/tools';
import type { LlmSelectedModel, SemanticLayerMode, StoryFormat } from '@nao/shared/types';

import type { WarehouseTableAccess } from '../services/context-access';
import type {
	ResolvedDocsContextAccess,
	ResolvedFilesContextAccess,
	ResolvedSkillsAccess,
} from '../services/user-group-context-access.service';
import { AgentSettings } from './agent-settings';

export interface QueryResult {
	columns: string[];
	data: Record<string, unknown>[];
	/** Set when the semantic layer compiled the SQL from this metric query. */
	semanticQuery?: executeSemanticQuery.SemanticQuery;
	/** The SQL as the model wrote it (filter templates included), set for results produced in the current run. */
	sqlQuery?: string;
	databaseId?: string;
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
	supportsCustomCharts: boolean;
	agentSettings: AgentSettings | null;
	/** The model the run itself uses; subagents inherit it unless the project pins another one. */
	modelSelection?: LlmSelectedModel;
	usageRunId?: string;
	managedAiBillingMode?: 'wallet' | 'unbilled';
	/**
	 * How the run may use the project's semantic layer, resolved once from nao_config.yaml
	 * and the admin settings. Null (or absent) when the project declares no semantic layer.
	 */
	semanticLayerMode?: SemanticLayerMode | null;
	envVars: Record<string, string>;
	warehouseTableAccess: WarehouseTableAccess;
	warehouseRowSecurity: WarehouseRowSecurity;
	docsContextAccess: ResolvedDocsContextAccess;
	filesContextAccess: ResolvedFilesContextAccess;
	/** MCP servers and tools the user's groups grant; spec files of other servers are hidden too. */
	mcpAccess: McpAccess;
	/** Project skills the user's groups grant; files of other skills under agent/skills/ are hidden too. */
	skillsAccess: ResolvedSkillsAccess;
	userGroupFeatures: UserGroupFeature[];
	userRulesGroupAccess: UserRulesGroupAccess;
	/** Project skills the user's groups load in full into the system prompt. */
	preloadedSkillNames?: string[];
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
	/** The story a quick question is about; the story tool edits it in its own chat when `canEdit`. */
	linkedStory?: LinkedStory;
}

export type McpToolContext = Omit<ToolContext, 'chatId'> & {
	chatId: null;
	storyCreationEnabled?: boolean;
};

export interface LinkedStory {
	storyId: string;
	chatId: string;
	slug: string;
	title: string;
	format: StoryFormat;
	canEdit: boolean;
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
	MetabaseCardResultSchema,
	MetabaseCardSchema,
	MetabaseCollectionSchema,
	MetabaseDashboardSchema,
	MetabaseDashboardSummarySchema,
	MetabaseExecutableQuerySchema,
	MetabaseExecutionParametersSchema,
} from '@nao/shared/metabase-migration';
import { z } from 'zod';

import { MetabaseMigrationSourceError, metabaseMigrationSourceService } from '../../services/metabase-migration-source';
import type { McpContext, ToolResult } from '../logging';
import { registerMcpTool } from './register-mcp-tool';

const SERVER_NAME_SCHEMA = z
	.string()
	.min(1)
	.optional()
	.describe('Configured Metabase MCP server name. Omit only when exactly one compatible server is enabled.');

export function registerMetabaseMigrationTools(server: McpServer, context: McpContext): void {
	registerMcpTool(server, context, {
		name: 'list_metabase_collections',
		title: 'List Metabase Collections',
		description: 'List normalized collections from a configured read-only Metabase MCP source.',
		inputSchema: {
			server_name: SERVER_NAME_SCHEMA,
		},
		outputSchema: {
			collections: z.array(MetabaseCollectionSchema),
		},
		handler: async ({ server_name }) =>
			structured({
				collections: await metabaseMigrationSourceService.listCollections(context, server_name),
			}),
		errorMessage: sourceErrorMessage,
	});

	registerMcpTool(server, context, {
		name: 'list_metabase_dashboards',
		title: 'List Metabase Dashboards',
		description: 'List normalized Metabase dashboards, optionally restricted to one collection.',
		inputSchema: {
			server_name: SERVER_NAME_SCHEMA,
			collection_id: z.number().int().positive().optional(),
		},
		outputSchema: {
			dashboards: z.array(MetabaseDashboardSummarySchema),
		},
		handler: async ({ server_name, collection_id }) =>
			structured({
				dashboards: await metabaseMigrationSourceService.listDashboards(context, {
					serverName: server_name,
					collectionId: collection_id,
				}),
			}),
		errorMessage: sourceErrorMessage,
	});

	registerMcpTool(server, context, {
		name: 'get_metabase_dashboard',
		title: 'Get Metabase Dashboard',
		description:
			'Read a normalized Metabase dashboard including tabs, cards, native or MBQL queries, visualization settings, parameters, and filter wiring.',
		inputSchema: {
			dashboard_id: z.number().int().positive(),
			server_name: SERVER_NAME_SCHEMA,
		},
		outputSchema: {
			dashboard: MetabaseDashboardSchema,
		},
		handler: async ({ dashboard_id, server_name }) =>
			structured({
				dashboard: await metabaseMigrationSourceService.getDashboard(context, dashboard_id, server_name),
			}),
		errorMessage: sourceErrorMessage,
	});

	registerMcpTool(server, context, {
		name: 'get_metabase_card',
		title: 'Get Metabase Card',
		description:
			'Read one normalized Metabase question, model, or metric card including its original query and whether visualization and result metadata are present.',
		inputSchema: {
			card_id: z.number().int().positive(),
			server_name: SERVER_NAME_SCHEMA,
		},
		outputSchema: {
			card: MetabaseCardSchema,
		},
		handler: async ({ card_id, server_name }) =>
			structured({
				card: await metabaseMigrationSourceService.getCard(context, card_id, server_name),
			}),
		errorMessage: sourceErrorMessage,
	});

	registerMcpTool(server, context, {
		name: 'compile_metabase_card_query',
		title: 'Compile Metabase Card Query',
		description:
			'Return SQL for a Metabase card. Parameterized native cards include driver boundParameters; MBQL is compiled by Metabase and never recreated from labels.',
		inputSchema: {
			card_id: z.number().int().positive(),
			server_name: SERVER_NAME_SCHEMA,
			parameters: MetabaseExecutionParametersSchema.optional(),
		},
		outputSchema: {
			query: MetabaseExecutableQuerySchema,
		},
		handler: async ({ card_id, server_name, parameters }) =>
			structured({
				query: await metabaseMigrationSourceService.compileCard(context, card_id, {
					serverName: server_name,
					parameters,
				}),
			}),
		errorMessage: sourceErrorMessage,
	});

	registerMcpTool(server, context, {
		name: 'execute_metabase_card',
		title: 'Execute Metabase Card',
		description:
			'Execute a saved Metabase card read-only and return normalized columns, rows, and result metadata for source-to-target verification.',
		inputSchema: {
			card_id: z.number().int().positive(),
			server_name: SERVER_NAME_SCHEMA,
			parameters: MetabaseExecutionParametersSchema.optional(),
		},
		outputSchema: {
			result: MetabaseCardResultSchema,
		},
		handler: async ({ card_id, server_name, parameters }) =>
			structured({
				result: await metabaseMigrationSourceService.executeCard(context, card_id, {
					serverName: server_name,
					parameters,
				}),
			}),
		errorMessage: sourceErrorMessage,
	});
}

function structured(output: Record<string, unknown>): ToolResult {
	return {
		content: [{ type: 'text', text: JSON.stringify(output) }],
		structuredContent: output,
	};
}

function sourceErrorMessage(error: unknown): string {
	if (error instanceof MetabaseMigrationSourceError) {
		return `${error.code.toUpperCase()}: ${error.message}`;
	}
	return `Metabase source operation failed: ${error instanceof Error ? error.message : String(error)}`;
}

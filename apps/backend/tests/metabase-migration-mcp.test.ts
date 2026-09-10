import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { registerMetabaseMigrationTools } from '../src/mcp/tools/metabase-migration';
import { metabaseMigrationSourceService } from '../src/services/metabase-migration-source';

type RegisteredHandler = (
	input: Record<string, unknown>,
	extra: never,
) => Promise<{ content: Array<{ type: string; text: string }>; structuredContent?: Record<string, unknown> }>;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Metabase migration MCP tools', () => {
	it('registers the structured source primitives and delegates with the caller context', async () => {
		const handlers = new Map<string, RegisteredHandler>();
		const configurations = new Map<string, { inputSchema?: Record<string, unknown> }>();
		const server = {
			registerTool: vi.fn(
				(
					name: string,
					configuration: { inputSchema?: Record<string, unknown> },
					handler: RegisteredHandler,
				) => {
					configurations.set(name, configuration);
					handlers.set(name, handler);
				},
			),
		} as unknown as McpServer;
		const context = {
			userId: 'user-1',
			projectId: 'project-1',
			settings: {
				enabled: true,
				subAgentModeEnabled: true,
				contextLayerModeEnabled: true,
			},
			chartDataMode: false,
		};
		vi.spyOn(metabaseMigrationSourceService, 'listCollections').mockResolvedValue([
			{
				id: 2,
				name: 'Ecommerce',
				description: null,
				parentId: 1,
				archived: false,
			},
		]);
		vi.spyOn(metabaseMigrationSourceService, 'listDashboards').mockResolvedValue([]);
		vi.spyOn(metabaseMigrationSourceService, 'getDashboard').mockResolvedValue({
			id: 5,
			name: 'Visualization Breadth',
			description: null,
			collectionId: 2,
			tabs: [],
			cards: [],
			parameters: [],
		});
		vi.spyOn(metabaseMigrationSourceService, 'getCard').mockResolvedValue({
			id: 60,
			name: 'Completed revenue share donut',
			description: null,
			databaseId: 2,
			type: 'question',
			display: 'pie',
			datasetQuery: { type: 'native', database: 2, native: { query: 'SELECT 1' } },
			visualizationSettings: { 'pie.show_total': true },
			parameters: [],
			resultMetadata: [],
			referencedObjects: [],
			hasVisualizationAndResultMetadata: true,
		});
		vi.spyOn(metabaseMigrationSourceService, 'compileCard').mockResolvedValue({
			sourceType: 'native',
			databaseId: 2,
			nativeSql: 'SELECT 1',
			templateParameters: {},
			resultMetadata: [],
		});
		vi.spyOn(metabaseMigrationSourceService, 'executeCard').mockResolvedValue({
			cardId: 60,
			status: 'completed',
			columns: ['value'],
			rows: [[1]],
			metadata: [],
		});

		registerMetabaseMigrationTools(server, context);

		expect([...handlers.keys()]).toEqual([
			'list_metabase_collections',
			'list_metabase_dashboards',
			'get_metabase_dashboard',
			'get_metabase_card',
			'compile_metabase_card_query',
			'execute_metabase_card',
		]);
		expect(configurations.get('compile_metabase_card_query')?.inputSchema).toHaveProperty('parameters');
		const result = await handlers.get('list_metabase_collections')!({ server_name: 'metabase' }, {} as never);
		expect(metabaseMigrationSourceService.listCollections).toHaveBeenCalledWith(context, 'metabase');
		expect(result.structuredContent).toEqual({
			collections: [
				{
					id: 2,
					name: 'Ecommerce',
					description: null,
					parentId: 1,
					archived: false,
				},
			],
		});
		expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
		await handlers.get('list_metabase_dashboards')!({ collection_id: 2 }, {} as never);
		await handlers.get('get_metabase_dashboard')!({ dashboard_id: 5 }, {} as never);
		await handlers.get('get_metabase_card')!({ card_id: 60 }, {} as never);
		await handlers.get('compile_metabase_card_query')!(
			{ card_id: 60, parameters: { category: 'Electronics' } },
			{} as never,
		);
		const execution = await handlers.get('execute_metabase_card')!({ card_id: 60 }, {} as never);
		expect(metabaseMigrationSourceService.listDashboards).toHaveBeenCalledWith(context, {
			collectionId: 2,
			serverName: undefined,
		});
		expect(metabaseMigrationSourceService.getDashboard).toHaveBeenCalledWith(context, 5, undefined);
		expect(metabaseMigrationSourceService.getCard).toHaveBeenCalledWith(context, 60, undefined);
		expect(metabaseMigrationSourceService.compileCard).toHaveBeenCalledWith(context, 60, {
			parameters: { category: 'Electronics' },
			serverName: undefined,
		});
		expect(execution.structuredContent).toEqual({
			result: { cardId: 60, status: 'completed', columns: ['value'], rows: [[1]], metadata: [] },
		});
	});
});

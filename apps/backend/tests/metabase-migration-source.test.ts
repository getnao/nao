import type { McpServerStatus } from '@nao/shared';
import { readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { McpAuthRequiredError } from '../src/services/mcp-oauth';
import {
	MetabaseMigrationSourceError,
	MetabaseMigrationSourceService,
} from '../src/services/metabase-migration-source';

const payloads = JSON.parse(
	readFileSync(new URL('./fixtures/metabase-source-payloads.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const context = { projectId: 'project-1', userId: 'user-1' };
const tools = [
	'metabase-list-collections',
	'metabase-list-dashboards',
	'metabase-get-dashboard',
	'metabase-get-question',
	'metabase-execute-question',
];

const status = (name = 'metabase', availableTools = tools): McpServerStatus => ({
	name,
	transport: 'stdio',
	enabled: true,
	discovered: true,
	connectionOk: true,
	oauth: false,
	oauthConnected: false,
	toolCount: availableTools.length,
	enabledToolCount: availableTools.length,
	tools: availableTools.map((tool) => ({ name: tool, enabled: true })),
	specPath: `/agent/mcps/${name}`,
});

const mcpOutput = (payload: unknown) => ({
	content: [{ type: 'text', text: JSON.stringify(payload) }],
});

const createClient = (responses: Record<string, unknown> = {}) => ({
	getServersStatus: vi.fn(async () => [status()]),
	connectForUser: vi.fn(async () => tools),
	callTool: vi.fn(async ({ tool }: { tool: string; args: Record<string, unknown> }) => mcpOutput(responses[tool])),
});

describe('Metabase migration source service', () => {
	it('normalizes observed collection and dashboard list payloads', async () => {
		const client = createClient({
			'metabase-list-collections': [
				{ id: 'root', name: 'Our analytics', description: null, location: '/' },
				{ id: '2', name: 'Ecommerce', description: null, location: '/1/' },
			],
			'metabase-list-dashboards': {
				data: [
					{
						id: '2',
						name: 'Native SQL Basics',
						description: 'Deterministic migration fixture',
						collection_id: '2',
						archived: false,
					},
					{
						id: '3',
						name: 'Other Dashboard',
						description: null,
						collection_id: '3',
						archived: false,
					},
				],
			},
		});
		const service = new MetabaseMigrationSourceService(client);

		await expect(service.listCollections(context)).resolves.toEqual([
			{
				id: 2,
				name: 'Ecommerce',
				description: null,
				parentId: 1,
				archived: false,
			},
		]);
		await expect(service.listDashboards(context, { collectionId: 2 })).resolves.toEqual([
			{
				id: 2,
				name: 'Native SQL Basics',
				description: 'Deterministic migration fixture',
				collectionId: 2,
				archived: false,
			},
		]);
		expect(client.callTool).toHaveBeenLastCalledWith(
			expect.objectContaining({
				server: 'metabase',
				tool: 'metabase-list-dashboards',
				args: {},
			}),
		);
	});

	it('normalizes tabs, cards, and virtual text from a dashboard', async () => {
		const client = createClient({ 'metabase-get-dashboard': payloads.dashboard });
		const service = new MetabaseMigrationSourceService(client);

		const dashboard = await service.getDashboard(context, 2);

		expect(dashboard.tabs).toEqual([
			{ id: 4, name: 'Overview', position: 0 },
			{ id: 5, name: 'Details', position: 1 },
		]);
		expect(dashboard.parameters).toEqual([]);
		expect(dashboard.cards[0]).toMatchObject({
			id: 12,
			cardId: null,
			tabId: 4,
			title: null,
			card: null,
			visualizationSettings: {
				virtual_card: {
					display: 'text',
				},
			},
		});
		expect(dashboard.cards[1]).toMatchObject({
			id: 11,
			cardId: 7,
			tabId: 5,
			row: 2,
			column: 0,
			width: 6,
			height: 4,
			parameterMappings: [],
			card: {
				id: 7,
				databaseId: 2,
				display: 'scalar',
				hasVisualizationAndResultMetadata: true,
			},
		});
	});

	it('normalizes filter definitions, native template tags, and selective card wiring', async () => {
		const client = createClient({ 'metabase-get-dashboard': payloads.filtersDashboard });
		const service = new MetabaseMigrationSourceService(client);

		const dashboard = await service.getDashboard(context, 3);

		expect(dashboard.parameters).toEqual([
			{
				id: 'period',
				name: 'Period',
				type: 'date/range',
				required: false,
			},
			{
				id: 'category',
				name: 'Category',
				type: 'string/=',
				defaultValue: ['Electronics'],
				required: true,
			},
		]);
		expect(dashboard.cards[0].parameterMappings).toEqual([
			{
				dashboardParameterId: 'period',
				targetCardId: 9,
				target: ['dimension', ['template-tag', 'period']],
				parameterType: 'date/range',
				required: false,
			},
			{
				dashboardParameterId: 'category',
				targetCardId: 9,
				target: ['variable', ['template-tag', 'category']],
				parameterType: 'string/=',
				defaultValue: ['Electronics'],
				required: true,
			},
		]);
		expect(dashboard.cards[0].card?.datasetQuery.native?.['template-tags']).toMatchObject({
			period: { type: 'dimension', 'widget-type': 'date/range' },
			category: { type: 'text' },
		});
		expect(dashboard.cards[1].parameterMappings).toEqual([]);
		expect(dashboard.cards[1].card?.datasetQuery.native?.['template-tags']).toEqual({});
	});

	it('returns native SQL directly and Metabase-compiled SQL for MBQL', async () => {
		const client = createClient();
		client.callTool.mockImplementation(async ({ tool, args }) => {
			if (tool === 'metabase-get-question') {
				return mcpOutput(args.questionId === 7 ? payloads.nativeCard : payloads.mbqlCard);
			}
			return mcpOutput(args.questionId === 8 ? payloads.mbqlExecution : payloads.execution);
		});
		const service = new MetabaseMigrationSourceService(client);

		await expect(service.getCard(context, 7)).resolves.toMatchObject({
			hasVisualizationAndResultMetadata: false,
			visualizationSettings: {},
			resultMetadata: [],
		});
		await expect(service.compileCard(context, 7)).resolves.toMatchObject({
			sourceType: 'native',
			databaseId: 2,
			nativeSql: 'SELECT SUM(quantity * unit_price) AS total_revenue FROM order_items',
		});
		const parameters = [{ id: 'region', type: 'string/=', value: ['EU'] }];
		await expect(service.compileCard(context, 8, { parameters })).resolves.toMatchObject({
			sourceType: 'mbql',
			databaseId: 2,
			compiledSql:
				'SELECT "public"."orders"."status" AS "status", COUNT(*) AS "count" FROM "public"."orders" GROUP BY "public"."orders"."status" ORDER BY "public"."orders"."status" ASC',
			originalMbql: {
				'source-table': 3,
				aggregation: [['count']],
				breakout: [['field', 12, null]],
			},
		});
		expect(client.callTool).toHaveBeenLastCalledWith(
			expect.objectContaining({
				tool: 'metabase-execute-question',
				args: { questionId: 8, parameters },
			}),
		);
	});

	it('compiles parameterized native cards through Metabase', async () => {
		const client = createClient();
		const nativeCard = payloads.nativeCard as Record<string, unknown>;
		const datasetQuery = nativeCard.dataset_query as Record<string, unknown>;
		const card = {
			...nativeCard,
			dataset_query: {
				...datasetQuery,
				native: {
					query: 'SELECT * FROM orders [[WHERE status = {{status}}]]',
					'template-tags': { status: { type: 'text' } },
				},
			},
		};
		client.callTool.mockImplementation(async ({ tool }) =>
			mcpOutput(
				tool === 'metabase-get-question'
					? card
					: {
							data: {
								native_form: {
									query: 'SELECT * FROM orders WHERE status = ?',
									params: ['completed'],
								},
							},
						},
			),
		);
		const service = new MetabaseMigrationSourceService(client);
		const parameters = [{ id: 'status', type: 'string/=', value: ['completed'] }];

		await expect(service.compileCard(context, 7, { parameters })).resolves.toMatchObject({
			sourceType: 'native',
			nativeSql: 'SELECT * FROM orders WHERE status = ?',
			boundParameters: ['completed'],
		});
		expect(client.callTool).toHaveBeenLastCalledWith(
			expect.objectContaining({
				tool: 'metabase-execute-question',
				args: { questionId: 7, parameters },
			}),
		);
	});

	it('preserves reusable model, metric, and segment provenance', async () => {
		const cards = new Map([
			[49, payloads.modelCard],
			[50, payloads.modelBackedCard],
			[51, payloads.metricCard],
			[52, payloads.segmentBackedCard],
		]);
		const client = createClient();
		client.callTool.mockImplementation(async ({ args }) => mcpOutput(cards.get(Number(args.questionId))));
		const service = new MetabaseMigrationSourceService(client);

		await expect(service.getCard(context, 49)).resolves.toMatchObject({
			type: 'model',
			referencedObjects: [],
		});
		await expect(service.getCard(context, 50)).resolves.toMatchObject({
			type: 'question',
			datasetQuery: { type: 'query', query: { 'lib/type': 'mbql/query' } },
			referencedObjects: [{ type: 'card', id: 49 }],
		});
		await expect(service.getCard(context, 51)).resolves.toMatchObject({
			type: 'metric',
			referencedObjects: [],
		});
		await expect(service.getCard(context, 52)).resolves.toMatchObject({
			type: 'question',
			referencedObjects: [{ type: 'segment', id: 7 }],
		});
	});

	it('preserves visualization and formatting settings without inference', async () => {
		const client = createClient({ 'metabase-get-question': payloads.visualizationCard });
		const service = new MetabaseMigrationSourceService(client);

		await expect(service.getCard(context, 60)).resolves.toMatchObject({
			display: 'pie',
			datasetQuery: {
				type: 'native',
				database: 2,
				native: { query: 'SELECT category, revenue FROM category_revenue', 'template-tags': {} },
			},
			visualizationSettings: {
				'pie.dimension': 'category',
				'pie.metric': 'revenue',
				'pie.show_total': true,
				'pie.percent_visibility': 'legend',
				column_settings: {
					'["name","revenue"]': {
						number_style: 'currency',
						currency: 'USD',
						decimals: 2,
					},
				},
			},
			hasVisualizationAndResultMetadata: true,
		});
	});

	it('normalizes executed rows and column metadata', async () => {
		const client = createClient();
		client.callTool.mockImplementation(async ({ args }) =>
			mcpOutput(args.questionId === 8 ? payloads.mbqlExecution : payloads.execution),
		);
		const service = new MetabaseMigrationSourceService(client);

		await expect(service.executeCard(context, 7)).resolves.toEqual({
			cardId: 7,
			status: 'completed',
			columns: ['total_revenue'],
			rows: [[5835]],
			metadata: [
				{
					name: 'total_revenue',
					display_name: 'Total Revenue',
					base_type: 'type/Decimal',
				},
			],
		});
		await expect(service.executeCard(context, 8)).resolves.toMatchObject({
			cardId: 8,
			status: 'completed',
			columns: ['status', 'count'],
			rows: [
				['completed', 18],
				['pending', 3],
				['refunded', 3],
			],
		});
	});

	it('requires an explicit server when several compatible servers exist', async () => {
		const client = createClient({ 'metabase-list-collections': payloads.collections });
		client.getServersStatus.mockResolvedValue([status('finance-metabase'), status('sales-metabase')]);
		const service = new MetabaseMigrationSourceService(client);

		await expect(service.listCollections(context)).rejects.toMatchObject({
			code: 'ambiguous_server',
		});
		await expect(service.listCollections(context, 'sales-metabase')).resolves.toHaveLength(1);
		expect(client.callTool).toHaveBeenCalledWith(expect.objectContaining({ server: 'sales-metabase' }));
	});

	it('reports disabled tools, authentication failures, and malformed output distinctly', async () => {
		const missingToolClient = createClient();
		missingToolClient.getServersStatus.mockResolvedValue([status('metabase', tools.slice(0, -1))]);
		missingToolClient.connectForUser.mockResolvedValue(tools.slice(0, -1));
		const missingToolService = new MetabaseMigrationSourceService(missingToolClient);
		await expect(missingToolService.executeCard(context, 7)).rejects.toMatchObject({
			code: 'missing_tool',
		});

		const authClient = createClient();
		authClient.callTool.mockRejectedValue(new McpAuthRequiredError('metabase'));
		const authService = new MetabaseMigrationSourceService(authClient);
		await expect(authService.listCollections(context)).rejects.toMatchObject({
			code: 'authentication',
		});

		const malformedClient = createClient();
		malformedClient.callTool.mockResolvedValue({ content: [{ type: 'text', text: '# not JSON' }] });
		const malformedService = new MetabaseMigrationSourceService(malformedClient);
		await expect(malformedService.listCollections(context)).rejects.toEqual(
			expect.objectContaining<Partial<MetabaseMigrationSourceError>>({
				code: 'unsupported_payload',
			}),
		);

		const failedToolClient = createClient();
		failedToolClient.callTool.mockResolvedValue({
			isError: true,
			content: [{ type: 'text', text: 'Request failed with status code 400' }],
		});
		await expect(
			new MetabaseMigrationSourceService(failedToolClient).listCollections(context),
		).rejects.toMatchObject({
			code: 'source_access',
			message: 'Metabase MCP returned an error: Request failed with status code 400',
		});
	});
});

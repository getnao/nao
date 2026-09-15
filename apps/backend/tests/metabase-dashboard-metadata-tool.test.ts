import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mcpMocks = vi.hoisted(() => ({
	callTool: vi.fn(),
	getServerUrl: vi.fn(),
}));

vi.mock('../src/env', () => ({
	env: {
		METABASE_URL: 'https://metabase.example.com',
		METABASE_API_KEY: 'test-key',
	},
}));

vi.mock('../src/services/mcp', () => ({
	mcpService: mcpMocks,
}));

import metabaseDashboardMetadata from '../src/agents/tools/metabase-dashboard-metadata';

const runTool = (dashboardId: number) =>
	metabaseDashboardMetadata.execute!(
		{ dashboard_id: dashboardId },
		{
			experimental_context: { projectId: 'project-1', userId: 'user-1' },
			toolCallId: 'tool-call',
			messages: [],
		},
	);

describe('Metabase dashboard metadata tool', () => {
	beforeEach(() => {
		mcpMocks.callTool.mockReset();
		mcpMocks.callTool.mockImplementation(async ({ args }: { args: { uris: string[] } }) => ({
			content: [{ type: 'text', text: '{}' }],
			structuredContent: {
				resources: args.uris.map((uri) =>
					uri.endsWith('/11')
						? { uri: 'metabase://question/canonical-11', error: 'Not found' }
						: { uri: uri.replace(/\/\d+$/, '/canonical-id'), content: {} },
				),
			},
		}));
		mcpMocks.getServerUrl.mockReset();
		mcpMocks.getServerUrl.mockResolvedValue('https://metabase.example.com/api/metabase-mcp');
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('authorizes the dashboard and questions as the caller before returning metadata', async () => {
		const fetchMock = vi.fn(
			async (_url: URL, _request?: RequestInit) =>
				new Response(
					JSON.stringify({
						id: 42,
						name: 'Revenue',
						tabs: [{ id: 3, name: 'Overview', position: 0, dashboard_id: 42 }],
						parameters: [
							{ id: 'period', type: 'date/range' },
							{ id: 'category', type: 'string/=' },
							{ id: 'forecast', type: 'string/=' },
						],
						creator: { id: 1, email: 'irrelevant@example.com' },
						dashcards: [
							{
								id: 7,
								card_id: 9,
								dashboard_tab_id: 3,
								row: 0,
								col: 0,
								size_x: 12,
								size_y: 6,
								parameter_mappings: [
									{
										parameter_id: 'period',
										card_id: 9,
										target: ['dimension', ['template-tag', 'period']],
									},
									{
										parameter_id: 'category',
										card_id: 9,
										target: ['variable', ['template-tag', 'category']],
									},
									{
										parameter_id: 'forecast',
										card_id: 12,
										target: ['variable', ['template-tag', 'forecast']],
									},
								],
								visualization_settings: { 'graph.show_values': true },
								card: {
									id: 9,
									name: 'Monthly revenue',
									display: 'line',
									type: 'question',
									database_id: 2,
									dataset_query: {
										'lib/type': 'mbql/query',
										stages: [
											{
												'lib/type': 'mbql.stage/native',
												native: 'SELECT month, revenue FROM monthly_revenue',
												'template-tags': [{ name: 'period', type: 'dimension' }],
											},
										],
									},
									visualization_settings: { 'graph.dimensions': ['month'] },
									result_metadata: [{ name: 'month' }, { name: 'revenue' }],
								},
								series: [
									{
										id: 12,
										name: 'Revenue forecast',
										display: 'line',
										database_id: 2,
										dataset_query: {
											type: 'native',
											native: {
												query: 'SELECT month, forecast FROM revenue_forecast',
												'template-tags': {
													forecast: { name: 'forecast', type: 'text' },
												},
											},
										},
										visualization_settings: { 'graph.metrics': ['forecast'] },
									},
								],
							},
							{
								id: 10,
								card_id: 11,
								dashboard_tab_id: 3,
								row: 0,
								col: 12,
								size_x: 12,
								size_y: 6,
								parameter_mappings: [
									{
										parameter_id: 'period',
										card_id: 11,
										target: ['dimension', ['template-tag', 'period']],
									},
								],
								card: {
									id: 11,
									name: 'Monthly revenue',
									display: 'line',
									database_id: 2,
									dataset_query: {
										type: 'native',
										native: {
											query: 'SELECT month, revenue FROM monthly_revenue',
											'template-tags': { period: { name: 'period', type: 'dimension' } },
										},
									},
								},
							},
							{
								id: 8,
								card_id: null,
								row: 6,
								col: 0,
								size_x: 12,
								size_y: 2,
								visualization_settings: { virtual_card: { text: '## Details' } },
								card: {},
							},
						],
					}),
					{ status: 200 },
				),
		);
		vi.stubGlobal('fetch', fetchMock);

		const output = await runTool(42);
		expect(output).toMatchObject({
			id: 42,
			filters: [{ id: 'period' }, { id: 'category' }, { id: 'forecast' }],
		});
		expect(output).not.toHaveProperty('creator');
		expect(output).not.toHaveProperty('dashcards');
		if (!('cards' in output)) {
			throw new Error('Expected immediate tool output');
		}
		expect(output.tabs).toEqual([{ id: 3, name: 'Overview', position: 0 }]);
		expect(output.cards[0]).toMatchObject({
			questionId: 9,
			tabId: 3,
			width: 12,
			parameterMappings: [
				{
					parameterId: 'period',
					questionId: 9,
					target: ['dimension', ['template-tag', 'period']],
				},
				{
					parameterId: 'category',
					questionId: 9,
					target: ['variable', ['template-tag', 'category']],
				},
			],
			effectiveFilterIds: ['period', 'category'],
			question: {
				display: 'line',
				queryType: 'mbql.stage/native',
				nativeSql: 'SELECT month, revenue FROM monthly_revenue',
				templateTags: { period: { name: 'period', type: 'dimension' } },
			},
		});
		expect(output.cards[0].question).not.toHaveProperty('dataset_query');
		expect(output.cards[0].question).not.toHaveProperty('result_metadata');
		expect(output.cards[0].series).toEqual([
			{
				questionId: 12,
				parameterMappings: [
					{
						parameterId: 'forecast',
						questionId: 12,
						target: ['variable', ['template-tag', 'forecast']],
					},
				],
				effectiveFilterIds: ['forecast'],
				question: expect.objectContaining({
					id: 12,
					name: 'Revenue forecast',
					nativeSql: 'SELECT month, forecast FROM revenue_forecast',
				}),
			},
		]);
		expect(output.cards[1]).toMatchObject({
			parameterMappings: [{ parameterId: 'period' }],
			effectiveFilterIds: ['period'],
			question: null,
		});
		expect(output.cards[2]).toMatchObject({
			effectiveFilterIds: [],
			question: null,
			visualizationSettings: { virtual_card: { text: '## Details' } },
		});
		const [url, request] = fetchMock.mock.calls[0];
		expect(String(url)).toBe('https://metabase.example.com/api/dashboard/42');
		expect(new Headers(request?.headers).get('x-api-key')).toBe('test-key');
		expect(mcpMocks.callTool).toHaveBeenNthCalledWith(1, {
			projectId: 'project-1',
			userId: 'user-1',
			server: 'metabase',
			tool: 'read_resource',
			args: { uris: ['metabase://dashboard/42'] },
			allowedServers: ['metabase'],
			requireUserOAuth: true,
		});
		expect(mcpMocks.callTool).toHaveBeenNthCalledWith(2, {
			projectId: 'project-1',
			userId: 'user-1',
			server: 'metabase',
			tool: 'read_resource',
			args: {
				uris: ['metabase://question/9', 'metabase://question/12', 'metabase://question/11'],
			},
			allowedServers: ['metabase'],
			requireUserOAuth: true,
		});
	});

	it('does not fetch dashboard metadata when the caller cannot read the dashboard', async () => {
		mcpMocks.callTool.mockResolvedValueOnce({
			content: [{ type: 'text', text: '{}' }],
			structuredContent: {
				resources: [{ uri: 'metabase://dashboard/42', error: 'Not found' }],
			},
		});
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(runTool(42)).rejects.toThrow('Metabase denied access to the requested dashboard');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reports Metabase API errors without returning partial metadata', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('Dashboard not found', { status: 404 })),
		);

		await expect(runTool(99)).rejects.toThrow('Metabase dashboard request failed (404): Dashboard not found');
	});
});

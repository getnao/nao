import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/env', () => ({
	env: {
		METABASE_URL: 'https://metabase.example.com',
		METABASE_API_KEY: 'test-key',
	},
}));

import metabaseDashboardMetadata from '../src/agents/tools/metabase-dashboard-metadata';

const runTool = (dashboardId: number) =>
	metabaseDashboardMetadata.execute!(
		{ dashboard_id: dashboardId },
		{ experimental_context: {}, toolCallId: 'tool-call', messages: [] },
	);

describe('Metabase dashboard metadata tool', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reads dashboard layout and visualization metadata with the configured API key', async () => {
		const fetchMock = vi.fn(
			async (_url: URL, _request?: RequestInit) =>
				new Response(
					JSON.stringify({
						id: 42,
						name: 'Revenue',
						tabs: [{ id: 3, name: 'Overview', position: 0, dashboard_id: 42 }],
						parameters: [{ id: 'period', type: 'date/range' }],
						creator: { id: 1, email: 'irrelevant@example.com' },
						dashcards: [
							{
								id: 7,
								card_id: 9,
								row: 0,
								col: 0,
								size_x: 12,
								size_y: 6,
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
			filters: [{ id: 'period' }],
		});
		expect(output).not.toHaveProperty('creator');
		expect(output).not.toHaveProperty('dashcards');
		if (!('cards' in output)) {
			throw new Error('Expected immediate tool output');
		}
		expect(output.tabs).toEqual([{ id: 3, name: 'Overview', position: 0 }]);
		expect(output.cards[0]).toMatchObject({
			questionId: 9,
			width: 12,
			question: {
				display: 'line',
				queryType: 'mbql.stage/native',
				nativeSql: 'SELECT month, revenue FROM monthly_revenue',
				templateTags: { period: { name: 'period', type: 'dimension' } },
			},
		});
		expect(output.cards[0].question).not.toHaveProperty('dataset_query');
		expect(output.cards[0].question).not.toHaveProperty('result_metadata');
		expect(output.cards[1]).toMatchObject({
			question: null,
			visualizationSettings: { virtual_card: { text: '## Details' } },
		});
		const [url, request] = fetchMock.mock.calls[0];
		expect(String(url)).toBe('https://metabase.example.com/api/dashboard/42');
		expect(new Headers(request?.headers).get('x-api-key')).toBe('test-key');
	});

	it('reports Metabase API errors without returning partial metadata', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('Dashboard not found', { status: 404 })),
		);

		await expect(runTool(99)).rejects.toThrow('Metabase dashboard request failed (404): Dashboard not found');
	});
});

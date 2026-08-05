import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/chat.queries', () => ({
	getQueryResultByQueryId: vi.fn(async () => null),
}));
vi.mock('../src/utils/map-boundary-cache', () => ({
	getCachedBoundary: vi.fn(() => null),
	setCachedBoundary: vi.fn(),
}));
vi.mock('../src/utils/safe-fetch', () => ({
	safeFetch: vi.fn(async () => {
		throw new Error('not mocked');
	}),
	parseAndValidateGeoJson: vi.fn(),
}));

import { createDisplayMapTool } from '../src/agents/tools/display-map';
import * as chatQueries from '../src/queries/chat.queries';
import type { QueryResult, ToolContext } from '../src/types/tools';
import * as safeFetchModule from '../src/utils/safe-fetch';

const displayMapTool = createDisplayMapTool();

const input = {
	query_id: 'q1',
	map_type: 'points' as const,
	latitude_key: 'lat',
	longitude_key: 'lng',
	title: 'Test map',
};

const rows = [{ lat: 48.85, lng: 2.35 }];

function execute(overrides: Partial<typeof input>, queryResults = new Map<string, QueryResult>()) {
	const context = {
		queryResults,
		chatId: 'chat1',
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	} as unknown as ToolContext;
	return displayMapTool.execute!({ ...input, ...overrides }, {
		experimental_context: context,
	} as Parameters<NonNullable<typeof displayMapTool.execute>>[1]);
}

describe('display_map execute', () => {
	it('rejects identical latitude and longitude keys', async () => {
		const queryResults = new Map([['q1', { columns: ['lat', 'lng'], data: rows }]]);
		const output = await execute({ longitude_key: 'lat' }, queryResults);
		expect(output).toMatchObject({ success: false });
		expect((output as { error?: string }).error).toContain('different columns');
	});

	it('rejects a query id that is neither in the run context nor in the chat history', async () => {
		const output = await execute({});
		expect(output).toMatchObject({ success: false });
		expect((output as { error?: string }).error).toContain('q1');
	});

	it('resolves query results from the persisted chat history', async () => {
		vi.mocked(chatQueries.getQueryResultByQueryId).mockResolvedValueOnce({
			columns: ['lat', 'lng'],
			data: rows,
		});
		const output = await execute({});
		expect(output).toMatchObject({ success: true });
	});

	it('succeeds when the keys match the query columns case-insensitively', async () => {
		const queryResults = new Map([['q1', { columns: ['LAT', 'LNG'], data: [{ LAT: 48.85, LNG: 2.35 }] }]]);
		const output = await execute({}, queryResults);
		expect(output).toMatchObject({ success: true });
	});

	it('rejects a key missing from the query columns and lists the available ones', async () => {
		const queryResults = new Map([['q1', { columns: ['lat', 'city'], data: rows }]]);
		const output = await execute({}, queryResults);
		expect(output).toMatchObject({ success: false });
		expect((output as { error?: string }).error).toContain('lng');
		expect((output as { error?: string }).error).toContain('lat, city');
	});

	it('rejects case variants that resolve to the same column', async () => {
		const queryResults = new Map([['q1', { columns: ['LAT'], data: [{ LAT: 48.85 }] }]]);
		const output = await execute({ latitude_key: 'lat', longitude_key: 'LAT' }, queryResults);
		expect(output).toMatchObject({ success: false });
	});

	it('accepts genuinely distinct case-variant columns via exact matches', async () => {
		const queryResults = new Map([['q1', { columns: ['lat', 'LAT'], data: [{ lat: 48.85, LAT: 2.35 }] }]]);
		const output = await execute({ latitude_key: 'lat', longitude_key: 'LAT' }, queryResults);
		expect(output).toMatchObject({ success: true });
	});

	it('reports plotted and dropped counts on success', async () => {
		const queryResults = new Map([['q1', { columns: ['lat', 'lng'], data: [...rows, { lat: null, lng: null }] }]]);
		const output = await execute({}, queryResults);
		expect(output).toMatchObject({ success: true, point_count: 1, dropped_row_count: 1 });
	});

	it('warns about popup keys missing from the query columns without failing', async () => {
		const queryResults = new Map([['q1', { columns: ['lat', 'lng', 'city'], data: rows }]]);
		const output = await execute({ label_key: 'cty', tooltip_keys: ['city', 'missing'] }, queryResults);
		expect(output).toMatchObject({ success: true });
		expect((output as { warning?: string }).warning).toContain('"cty"');
		expect((output as { warning?: string }).warning).toContain('"missing"');
		expect((output as { warning?: string }).warning).not.toContain('"city"');
	});

	it('warns when the result exceeds the rendered point cap', async () => {
		const manyRows = Array.from({ length: 5001 }, (_, i) => ({
			lat: 40 + (i % 100) / 100,
			lng: 2 + (i % 100) / 100,
		}));
		const queryResults = new Map([['q1', { columns: ['lat', 'lng'], data: manyRows }]]);
		const output = await execute({}, queryResults);
		expect(output).toMatchObject({ success: true, point_count: 5001 });
		expect((output as { warning?: string }).warning).toContain('first 5000 points');
	});

	it('omits the warning when popup keys resolve', async () => {
		const queryResults = new Map([['q1', { columns: ['lat', 'lng', 'CITY'], data: rows }]]);
		const output = await execute({ label_key: 'city' }, queryResults);
		expect(output).toMatchObject({ success: true });
		expect((output as { warning?: string }).warning).toBeUndefined();
	});

	it('rejects a query result with no plottable coordinates', async () => {
		const queryResults = new Map([['q1', { columns: ['lat', 'lng'], data: [{ lat: null, lng: null }] }]]);
		const output = await execute({}, queryResults);
		expect(output).toMatchObject({ success: false });
		expect((output as { error?: string }).error).toContain('no rows with valid');
	});

	it('rejects an empty query result', async () => {
		const queryResults = new Map([['q1', { columns: ['lat', 'lng'], data: [] }]]);
		const output = await execute({}, queryResults);
		expect(output).toMatchObject({ success: false });
	});
});

describe('display_map execute — choropleth with boundaries_url', () => {
	const geometry = {
		type: 'Polygon',
		coordinates: [
			[
				[0, 0],
				[1, 0],
				[1, 1],
				[0, 0],
			],
		],
	};
	const geojson = {
		type: 'FeatureCollection',
		features: [
			{ type: 'Feature', geometry, properties: { iso: 'FR' } },
			{ type: 'Feature', geometry, properties: { iso: 'DE' } },
		],
	};

	const choroplethInput = {
		query_id: 'q1',
		map_type: 'choropleth' as const,
		title: 'Test choropleth',
		value_key: 'value',
		region_key: 'country',
		boundaries_url: 'https://example.com/regions.geojson',
	};

	function executeChoropleth(overrides = {}, queryResults = new Map<string, QueryResult>()) {
		const context = {
			queryResults,
			chatId: 'chat1',
			generatedArtifacts: { charts: [], maps: [], stories: [] },
		} as unknown as ToolContext;
		const tool = createDisplayMapTool();
		return tool.execute!({ ...choroplethInput, ...overrides }, {
			experimental_context: context,
		} as Parameters<NonNullable<typeof tool.execute>>[1]);
	}

	it('returns region_count and dropped_row_count when all rows match', async () => {
		vi.mocked(safeFetchModule.safeFetch).mockResolvedValueOnce('');
		vi.mocked(safeFetchModule.parseAndValidateGeoJson).mockReturnValueOnce({
			geojson,
			propertyKeys: ['iso'],
			featureCount: 2,
		});
		const queryResults = new Map([
			[
				'q1',
				{
					columns: ['country', 'value'],
					data: [
						{ country: 'FR', value: 10 },
						{ country: 'DE', value: 20 },
					],
				},
			],
		]);
		const output = await executeChoropleth({}, queryResults);
		expect(output).toMatchObject({ success: true, region_count: 2, dropped_row_count: 0 });
	});

	it('reports dropped rows when region_key does not match any feature', async () => {
		vi.mocked(safeFetchModule.safeFetch).mockResolvedValueOnce('');
		vi.mocked(safeFetchModule.parseAndValidateGeoJson).mockReturnValueOnce({
			geojson,
			propertyKeys: ['iso'],
			featureCount: 2,
		});
		const queryResults = new Map([
			[
				'q1',
				{
					columns: ['country', 'value'],
					data: [
						{ country: 'FR', value: 10 },
						{ country: 'XX', value: 5 },
					],
				},
			],
		]);
		const output = await executeChoropleth({}, queryResults);
		expect(output).toMatchObject({ success: true, region_count: 1, dropped_row_count: 1 });
		expect((output as { warning?: string }).warning).toContain('1 row');
	});

	it('fails when no rows match any feature', async () => {
		vi.mocked(safeFetchModule.safeFetch).mockResolvedValueOnce('');
		vi.mocked(safeFetchModule.parseAndValidateGeoJson).mockReturnValueOnce({
			geojson,
			propertyKeys: ['iso'],
			featureCount: 2,
		});
		const queryResults = new Map([['q1', { columns: ['country', 'value'], data: [{ country: 'XX', value: 5 }] }]]);
		const output = await executeChoropleth({}, queryResults);
		expect(output).toMatchObject({ success: false });
		expect((output as { error?: string }).error).toContain('No rows matched');
	});

	it('fails when safeFetch throws', async () => {
		vi.mocked(safeFetchModule.safeFetch).mockRejectedValueOnce(new Error('Only HTTPS URLs are allowed.'));
		const queryResults = new Map([['q1', { columns: ['country', 'value'], data: [{ country: 'FR', value: 10 }] }]]);
		const output = await executeChoropleth({}, queryResults);
		expect(output).toMatchObject({ success: false });
		expect((output as { error?: string }).error).toContain('Only HTTPS');
	});

	it('fails when region_key is missing from query columns', async () => {
		const queryResults = new Map([['q1', { columns: ['country', 'value'], data: [] }]]);
		const output = await executeChoropleth({ region_key: 'missing_key' }, queryResults);
		expect(output).toMatchObject({ success: false });
		expect((output as { error?: string }).error).toContain('missing_key');
	});
});

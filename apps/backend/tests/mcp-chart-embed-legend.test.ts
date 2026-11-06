import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getMcpQueryData: vi.fn(),
	insertMcpChartEmbed: vi.fn(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/chat.queries', () => ({}));
vi.mock('../src/queries/story.queries', () => ({}));
vi.mock('../src/queries/mcp-query-data.queries', () => ({
	getMcpQueryData: mocks.getMcpQueryData,
	upsertMcpQueryData: vi.fn(),
}));
vi.mock('../src/queries/mcp-embed.queries', () => ({
	insertMcpChartEmbed: mocks.insertMcpChartEmbed,
	insertMcpMapEmbed: vi.fn(),
}));

import type { displayChart } from '@nao/shared/tools';

import type { McpContext } from '../src/mcp/logging';
import { buildChartEmbedFromArtifact } from '../src/mcp/tools/helpers';

const CTX = { userId: 'user-id', projectId: 'project-id', chartDataMode: true } as McpContext;

const ARTIFACT: displayChart.ChartInput = {
	query_id: 'query-id',
	chart_type: 'bar',
	x_axis_key: 'month',
	x_axis_type: 'category',
	series: [{ data_key: 'inspections' }],
	title: 'Total inspections',
};

describe('buildChartEmbedFromArtifact legend visibility', () => {
	beforeEach(() => {
		mocks.getMcpQueryData.mockResolvedValue({
			columns: ['month', 'inspections'],
			data: [{ month: 'Jan', inspections: 12 }],
		});
		mocks.insertMcpChartEmbed.mockResolvedValue(true);
	});

	it('carries show_legend into the chart block and the stored embed config', async () => {
		const result = await buildChartEmbedFromArtifact({ ...ARTIFACT, show_legend: false }, CTX, {
			chatId: null,
			callLogId: 'call-log-id',
		});

		expect(result && 'payload' in result && result.payload.block).toContain('show_legend="false"');
		expect(mocks.insertMcpChartEmbed.mock.lastCall?.[0].chartConfig.showLegend).toBe(false);
	});

	it('leaves show_legend out when the artifact does not set it', async () => {
		const result = await buildChartEmbedFromArtifact(ARTIFACT, CTX, { chatId: null, callLogId: 'call-log-id' });

		expect(result && 'payload' in result && result.payload.block).not.toContain('show_legend');
		expect(mocks.insertMcpChartEmbed.mock.lastCall?.[0].chartConfig.showLegend).toBeUndefined();
	});
});

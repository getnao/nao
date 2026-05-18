import type { McpChartEmbedStoredConfig } from '@nao/shared';
import { eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export async function insertMcpChartEmbed(params: {
	chartEmbedId: string;
	queryId: string;
	projectId: string;
	chartConfig: McpChartEmbedStoredConfig;
	sourceChatId: string | null;
}): Promise<void> {
	await db
		.insert(s.mcpChartEmbed)
		.values({
			chartEmbedId: params.chartEmbedId,
			queryId: params.queryId,
			projectId: params.projectId,
			chartConfig: params.chartConfig,
			sourceChatId: params.sourceChatId,
		})
		.execute();
}

export async function getMcpChartEmbedById(chartEmbedId: string): Promise<{
	projectId: string;
	queryId: string;
	chartConfig: McpChartEmbedStoredConfig;
	sourceChatId: string | null;
} | null> {
	const [row] = await db
		.select({
			projectId: s.mcpChartEmbed.projectId,
			queryId: s.mcpChartEmbed.queryId,
			chartConfig: s.mcpChartEmbed.chartConfig,
			sourceChatId: s.mcpChartEmbed.sourceChatId,
		})
		.from(s.mcpChartEmbed)
		.where(eq(s.mcpChartEmbed.chartEmbedId, chartEmbedId))
		.limit(1)
		.execute();

	if (!row) {
		return null;
	}
	return {
		projectId: row.projectId,
		queryId: row.queryId,
		chartConfig: row.chartConfig,
		sourceChatId: row.sourceChatId ?? null,
	};
}

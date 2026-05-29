import type { McpChartEmbedStoredConfig } from '@nao/shared';
import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export async function insertMcpChartEmbed(params: {
	chartEmbedId: string;
	queryId: string;
	projectId: string;
	chartConfig: McpChartEmbedStoredConfig;
	sourceChatId: string | null;
}): Promise<boolean> {
	return await db.transaction(async (tx) => {
		const [match] = await tx
			.select({ queryId: s.mcpQueryData.queryId })
			.from(s.mcpQueryData)
			.where(and(eq(s.mcpQueryData.queryId, params.queryId), eq(s.mcpQueryData.projectId, params.projectId)))
			.limit(1)
			.execute();

		if (!match) {
			return false;
		}

		await tx
			.insert(s.mcpChartEmbed)
			.values({
				chartEmbedId: params.chartEmbedId,
				queryId: params.queryId,
				chartConfig: params.chartConfig,
				sourceChatId: params.sourceChatId,
			})
			.execute();

		return true;
	});
}

export async function getMcpChartEmbedById(chartEmbedId: string): Promise<{
	projectId: string;
	queryId: string;
	chartConfig: McpChartEmbedStoredConfig;
	sourceChatId: string | null;
} | null> {
	const [row] = await db
		.select({
			projectId: s.mcpQueryData.projectId,
			queryId: s.mcpChartEmbed.queryId,
			chartConfig: s.mcpChartEmbed.chartConfig,
			sourceChatId: s.mcpChartEmbed.sourceChatId,
		})
		.from(s.mcpChartEmbed)
		.innerJoin(s.mcpQueryData, eq(s.mcpChartEmbed.queryId, s.mcpQueryData.queryId))
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

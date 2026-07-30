import type { McpMapEmbedStoredConfig } from '@nao/shared';
import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export async function insertMcpMapEmbed(params: {
	mapEmbedId: string;
	queryId: string;
	projectId: string;
	mapConfig: McpMapEmbedStoredConfig;
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
			.insert(s.mcpMapEmbed)
			.values({
				mapEmbedId: params.mapEmbedId,
				queryId: params.queryId,
				mapConfig: params.mapConfig,
				sourceChatId: params.sourceChatId,
			})
			.execute();

		return true;
	});
}

export async function getMcpMapEmbedById(mapEmbedId: string): Promise<{
	projectId: string;
	queryId: string;
	mapConfig: McpMapEmbedStoredConfig;
	sourceChatId: string | null;
} | null> {
	const [row] = await db
		.select({
			projectId: s.mcpQueryData.projectId,
			queryId: s.mcpMapEmbed.queryId,
			mapConfig: s.mcpMapEmbed.mapConfig,
			sourceChatId: s.mcpMapEmbed.sourceChatId,
		})
		.from(s.mcpMapEmbed)
		.innerJoin(s.mcpQueryData, eq(s.mcpMapEmbed.queryId, s.mcpQueryData.queryId))
		.where(eq(s.mcpMapEmbed.mapEmbedId, mapEmbedId))
		.limit(1)
		.execute();

	if (!row) {
		return null;
	}
	return {
		projectId: row.projectId,
		queryId: row.queryId,
		mapConfig: row.mapConfig,
		sourceChatId: row.sourceChatId ?? null,
	};
}

import type { McpChartEmbedStoredConfig, McpMapEmbedStoredConfig } from '@nao/shared';
import { and, eq } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';

import s from '../db/abstractSchema';
import { db } from '../db/db';

type McpEmbedTableRef = {
	table: SQLiteTable;
	idColumn: SQLiteColumn;
	queryIdColumn: SQLiteColumn;
	configColumn: SQLiteColumn;
	sourceChatIdColumn: SQLiteColumn;
};

async function insertMcpEmbed(params: {
	queryId: string;
	projectId: string;
	table: SQLiteTable;
	values: Record<string, unknown>;
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
			.insert(params.table)
			.values(params.values as never)
			.execute();

		return true;
	});
}

async function getMcpEmbedById<TConfig>(
	ref: McpEmbedTableRef,
	embedId: string,
): Promise<{
	projectId: string;
	queryId: string;
	config: TConfig;
	sourceChatId: string | null;
} | null> {
	const [row] = await db
		.select({
			projectId: s.mcpQueryData.projectId,
			queryId: ref.queryIdColumn,
			config: ref.configColumn,
			sourceChatId: ref.sourceChatIdColumn,
		})
		.from(ref.table)
		.innerJoin(s.mcpQueryData, eq(ref.queryIdColumn, s.mcpQueryData.queryId))
		.where(eq(ref.idColumn, embedId))
		.limit(1)
		.execute();

	if (!row) {
		return null;
	}
	return {
		projectId: row.projectId,
		queryId: row.queryId as string,
		config: row.config as TConfig,
		sourceChatId: (row.sourceChatId as string | null) ?? null,
	};
}

export async function insertMcpChartEmbed(params: {
	chartEmbedId: string;
	queryId: string;
	projectId: string;
	chartConfig: McpChartEmbedStoredConfig;
	sourceChatId: string | null;
}): Promise<boolean> {
	return await insertMcpEmbed({
		queryId: params.queryId,
		projectId: params.projectId,
		table: s.mcpChartEmbed,
		values: {
			chartEmbedId: params.chartEmbedId,
			queryId: params.queryId,
			chartConfig: params.chartConfig,
			sourceChatId: params.sourceChatId,
		},
	});
}

export async function getMcpChartEmbedById(chartEmbedId: string): Promise<{
	projectId: string;
	queryId: string;
	chartConfig: McpChartEmbedStoredConfig;
	sourceChatId: string | null;
} | null> {
	const embed = await getMcpEmbedById<McpChartEmbedStoredConfig>(
		{
			table: s.mcpChartEmbed,
			idColumn: s.mcpChartEmbed.chartEmbedId,
			queryIdColumn: s.mcpChartEmbed.queryId,
			configColumn: s.mcpChartEmbed.chartConfig,
			sourceChatIdColumn: s.mcpChartEmbed.sourceChatId,
		},
		chartEmbedId,
	);

	if (!embed) {
		return null;
	}
	return {
		projectId: embed.projectId,
		queryId: embed.queryId,
		chartConfig: embed.config,
		sourceChatId: embed.sourceChatId,
	};
}

export async function insertMcpMapEmbed(params: {
	mapEmbedId: string;
	queryId: string;
	projectId: string;
	mapConfig: McpMapEmbedStoredConfig;
	sourceChatId: string | null;
}): Promise<boolean> {
	return await insertMcpEmbed({
		queryId: params.queryId,
		projectId: params.projectId,
		table: s.mcpMapEmbed,
		values: {
			mapEmbedId: params.mapEmbedId,
			queryId: params.queryId,
			mapConfig: params.mapConfig,
			sourceChatId: params.sourceChatId,
		},
	});
}

export async function getMcpMapEmbedById(mapEmbedId: string): Promise<{
	projectId: string;
	queryId: string;
	mapConfig: McpMapEmbedStoredConfig;
	sourceChatId: string | null;
} | null> {
	const embed = await getMcpEmbedById<McpMapEmbedStoredConfig>(
		{
			table: s.mcpMapEmbed,
			idColumn: s.mcpMapEmbed.mapEmbedId,
			queryIdColumn: s.mcpMapEmbed.queryId,
			configColumn: s.mcpMapEmbed.mapConfig,
			sourceChatIdColumn: s.mcpMapEmbed.sourceChatId,
		},
		mapEmbedId,
	);

	if (!embed) {
		return null;
	}
	return {
		projectId: embed.projectId,
		queryId: embed.queryId,
		mapConfig: embed.config,
		sourceChatId: embed.sourceChatId,
	};
}

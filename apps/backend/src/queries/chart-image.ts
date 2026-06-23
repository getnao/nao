import { displayChart, executeSql } from '@nao/shared/tools';
import { and, eq, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { takeFirstOrThrow } from '../utils/queries';

const DISPLAY_CHART_TOOL_TYPE = 'tool-display_chart';

export const getChartById = async (id: string): Promise<string> => {
	const result = await takeFirstOrThrow(
		db
			.select({ data: s.message_part_chart_image.data })
			.from(s.message_part_chart_image)
			.where(eq(s.message_part_chart_image.id, id))
			.execute(),
	);
	return result.data;
};

export const getChartConfigByToolCallId = async (toolCallId: string): Promise<displayChart.Input> => {
	const result = await takeFirstOrThrow(
		db
			.select({ toolInput: s.messagePart.toolInput })
			.from(s.messagePart)
			.where(getDisplayChartToolCallFilter(toolCallId))
			.execute(),
	);
	return displayChart.InputSchema.parse(result.toolInput);
};

export const getExecuteSqlPartByQueryId = async (
	queryId: string,
): Promise<{ toolInput: executeSql.Input; toolOutput: executeSql.Output }> => {
	const jsonIdFilter =
		dbConfig.dialect === Dialect.Postgres
			? sql`${s.messagePart.toolOutput}->>'id' = ${queryId}`
			: sql`json_extract(${s.messagePart.toolOutput}, '$.id') = ${queryId}`;

	const result = await takeFirstOrThrow(
		db
			.select({ toolInput: s.messagePart.toolInput, toolOutput: s.messagePart.toolOutput })
			.from(s.messagePart)
			.where(jsonIdFilter)
			.execute(),
	);

	return {
		toolInput: executeSql.InputSchema.parse(result.toolInput),
		toolOutput: executeSql.OutputSchema.parse(result.toolOutput),
	};
};

export const getChartDataByQueryId = async (queryId: string): Promise<executeSql.Output['data']> => {
	const result = await getExecuteSqlPartByQueryId(queryId);
	return result.toolOutput.data;
};

export const saveChart = async (toolCallId: string, data: string): Promise<string> => {
	const row = await takeFirstOrThrow(
		db
			.insert(s.message_part_chart_image)
			.values({ toolCallId, data })
			.onConflictDoUpdate({ target: s.message_part_chart_image.toolCallId, set: { data } })
			.returning({ id: s.message_part_chart_image.id })
			.execute(),
	);
	return row.id;
};

/** Returns the project owner and parent chat of the chat that contains the given chart tool call. */
export const getChartOwnerInfo = async (
	toolCallId: string,
): Promise<{ projectId: string; userId: string; chatId: string } | null> => {
	const [row] = await db
		.select({ projectId: s.chat.projectId, userId: s.chat.userId, chatId: s.chat.id })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.innerJoin(s.chat, eq(s.chatMessage.chatId, s.chat.id))
		.where(getDisplayChartToolCallFilter(toolCallId))
		.execute();
	return row ?? null;
};

/** Persists an updated `display_chart` config for the given tool call. */
export const updateChartConfig = async (toolCallId: string, config: displayChart.Input): Promise<void> => {
	await db.transaction(async (tx) => {
		await tx
			.update(s.messagePart)
			.set({ toolInput: config })
			.where(getDisplayChartToolCallFilter(toolCallId))
			.execute();

		// Invalidate any cached PNG so externally-served chart images refresh.
		await tx
			.delete(s.message_part_chart_image)
			.where(eq(s.message_part_chart_image.toolCallId, toolCallId))
			.execute();
	});
};

function getDisplayChartToolCallFilter(toolCallId: string) {
	return and(eq(s.messagePart.toolCallId, toolCallId), eq(s.messagePart.type, DISPLAY_CHART_TOOL_TYPE));
}

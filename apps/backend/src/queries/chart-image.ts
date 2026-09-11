import { displayChart, executeSql } from '@nao/shared/tools';
import { and, asc, eq, isNull, like, lt } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { HandlerError } from '../utils/error';
import { takeFirstOrThrow } from '../utils/queries';
import { selectLatestDisplayChartTableFormats } from './chart-image.utils';
import { getLatestExecuteSqlByQueryId } from './execute-sql.queries';

const DISPLAY_CHART_TOOL_TYPE = 'tool-display_chart';
const CLIPBOARD_CHART_PREFIX = 'clipboard:';
const CLIPBOARD_CHART_TTL_MS = 24 * 60 * 60 * 1000;

export const getChartById = async (id: string): Promise<{ data: string; expiresAt: Date | null } | undefined> => {
	const [row] = await db
		.select({
			data: s.message_part_chart_image.data,
			toolCallId: s.message_part_chart_image.toolCallId,
			createdAt: s.message_part_chart_image.createdAt,
		})
		.from(s.message_part_chart_image)
		.where(eq(s.message_part_chart_image.id, id))
		.execute();
	if (!row) {
		return undefined;
	}
	if (!row.toolCallId.startsWith(CLIPBOARD_CHART_PREFIX)) {
		return { data: row.data, expiresAt: null };
	}

	const expiresAt = new Date(row.createdAt.getTime() + CLIPBOARD_CHART_TTL_MS);
	return expiresAt > new Date() ? { data: row.data, expiresAt } : undefined;
};

export const saveClipboardChart = async (data: string): Promise<string> => {
	const row = await takeFirstOrThrow(
		db
			.insert(s.message_part_chart_image)
			.values({ toolCallId: `${CLIPBOARD_CHART_PREFIX}${crypto.randomUUID()}`, data })
			.returning({ id: s.message_part_chart_image.id })
			.execute(),
	);
	return row.id;
};

export const deleteExpiredClipboardCharts = async (): Promise<void> => {
	const cutoff = new Date(Date.now() - CLIPBOARD_CHART_TTL_MS);
	await db
		.delete(s.message_part_chart_image)
		.where(
			and(
				like(s.message_part_chart_image.toolCallId, `${CLIPBOARD_CHART_PREFIX}%`),
				lt(s.message_part_chart_image.createdAt, cutoff),
			),
		)
		.execute();
};

export const getDisplayConfigByToolCallId = async (toolCallId: string): Promise<displayChart.Input> => {
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
	const result = await getLatestExecuteSqlByQueryId(queryId);
	if (!result) {
		throw new HandlerError('NOT_FOUND', `Query ${queryId} not found.`);
	}
	return {
		toolInput: result.toolInput,
		toolOutput: result.toolOutput,
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

export const getDisplayChartTableFormatsForChat = async (
	chatId: string,
): Promise<Record<string, displayChart.ColumnConditionalFormats>> => {
	const rows = await db
		.select({ toolInput: s.messagePart.toolInput })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(
			and(
				eq(s.chatMessage.chatId, chatId),
				eq(s.messagePart.type, DISPLAY_CHART_TOOL_TYPE),
				isNull(s.chatMessage.supersededAt),
			),
		)
		.orderBy(asc(s.chatMessage.createdAt), asc(s.messagePart.order))
		.execute();

	return selectLatestDisplayChartTableFormats(rows);
};

function getDisplayChartToolCallFilter(toolCallId: string) {
	return and(eq(s.messagePart.toolCallId, toolCallId), eq(s.messagePart.type, DISPLAY_CHART_TOOL_TYPE));
}

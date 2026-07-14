import type { ColumnConditionalFormats } from '@nao/shared/conditional-formatting';
import { displayTable } from '@nao/shared/tools';
import { and, asc, eq, isNull } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { selectLatestDisplayTableFormats } from './table-config.utils';

const DISPLAY_TABLE_TOOL_TYPE = 'tool-display_table';

/** Returns the project owner and parent chat of the chat that contains the given table tool call. */
export const getTableOwnerInfo = async (
	toolCallId: string,
): Promise<{ projectId: string; userId: string; chatId: string } | null> => {
	const [row] = await db
		.select({ projectId: s.chat.projectId, userId: s.chat.userId, chatId: s.chat.id })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.innerJoin(s.chat, eq(s.chatMessage.chatId, s.chat.id))
		.where(getDisplayTableToolCallFilter(toolCallId))
		.execute();
	return row ?? null;
};

/** Persists an updated `display_table` config for the given tool call. */
export const updateTableConfig = async (toolCallId: string, config: displayTable.Input): Promise<void> => {
	await db
		.update(s.messagePart)
		.set({ toolInput: config })
		.where(getDisplayTableToolCallFilter(toolCallId))
		.execute();
};

/**
 * Maps each `display_table` query_id in a chat to its stored conditional
 * formatting, so a `<table query_id="…" />` block can inherit it deterministically.
 *
 * Only the active (non-superseded) message branch is considered, and rows are
 * ordered oldest → newest so the most recent `display_table` for a given
 * query_id wins — a stable, predictable result even when the same query is
 * displayed multiple times with different edits.
 */
export const getDisplayTableFormatsForChat = async (
	chatId: string,
): Promise<Record<string, ColumnConditionalFormats>> => {
	const rows = await db
		.select({ toolInput: s.messagePart.toolInput })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(
			and(
				eq(s.chatMessage.chatId, chatId),
				eq(s.messagePart.type, DISPLAY_TABLE_TOOL_TYPE),
				isNull(s.chatMessage.supersededAt),
			),
		)
		.orderBy(asc(s.chatMessage.createdAt), asc(s.messagePart.order))
		.execute();

	return selectLatestDisplayTableFormats(rows);
};

function getDisplayTableToolCallFilter(toolCallId: string) {
	return and(eq(s.messagePart.toolCallId, toolCallId), eq(s.messagePart.type, DISPLAY_TABLE_TOOL_TYPE));
}

import { displayTable } from '@nao/shared/tools';
import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

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

function getDisplayTableToolCallFilter(toolCallId: string) {
	return and(eq(s.messagePart.toolCallId, toolCallId), eq(s.messagePart.type, DISPLAY_TABLE_TOOL_TYPE));
}

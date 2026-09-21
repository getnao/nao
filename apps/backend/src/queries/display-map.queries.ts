import { displayMap } from '@nao/shared/tools';
import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

const DISPLAY_MAP_TOOL_TYPE = 'tool-display_map';

export const getMapOwnerId = async (toolCallId: string): Promise<string | undefined> => {
	const [row] = await db
		.select({ userId: s.chat.userId })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.innerJoin(s.chat, eq(s.chatMessage.chatId, s.chat.id))
		.where(getDisplayMapToolCallFilter(toolCallId))
		.execute();
	return row?.userId;
};

export const updateMapConfig = async (toolCallId: string, config: displayMap.Input): Promise<void> => {
	await db.update(s.messagePart).set({ toolInput: config }).where(getDisplayMapToolCallFilter(toolCallId)).execute();
};

function getDisplayMapToolCallFilter(toolCallId: string) {
	return and(eq(s.messagePart.toolCallId, toolCallId), eq(s.messagePart.type, DISPLAY_MAP_TOOL_TYPE));
}

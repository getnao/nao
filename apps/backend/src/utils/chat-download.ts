import type { DateFormatSettings } from '@nao/shared/date';
import { extractQueryIds } from '@nao/shared/story-segments';
import type { DownloadFormat } from '@nao/shared/types';

import * as chatQueries from '../queries/chat.queries';
import type { UIMessage } from '../types/chat';
import { buildChatStoryCode, type ChatStoryCodeOptions } from './chat-story-code';
import { buildDownloadResponse, type QueryDataMap } from './story-download';

export interface ChatDownloadInput {
	chatId: string;
	title: string;
	createdAt?: number;
	updatedAt?: number;
	messages: UIMessage[];
	format: DownloadFormat;
	includeErrors?: boolean;
	includeSql?: boolean;
	includePython?: boolean;
	dateFormat?: DateFormatSettings | null;
}

/**
 * Renders a whole chat conversation to a downloadable file (PDF/HTML) by
 * reusing the story rendering pipeline: the conversation is turned into story
 * code, its query results are rehydrated from the chat history, and charts are
 * drawn as SVGs in the generated document.
 */
export async function buildChatDownloadResponse(
	input: ChatDownloadInput,
): Promise<{ data: string; filename: string; mimeType: string }> {
	const codeOptions: ChatStoryCodeOptions = {
		includeErrors: input.includeErrors,
		includeSql: input.includeSql,
		includePython: input.includePython,
	};
	const code = buildChatStoryCode(
		input.messages,
		{ title: input.title, createdAt: input.createdAt, updatedAt: input.updatedAt },
		codeOptions,
	);
	const queryData = await resolveQueryData(input.chatId, code);
	return buildDownloadResponse(input.format, input.title, code, queryData, input.dateFormat);
}

async function resolveQueryData(chatId: string, code: string): Promise<QueryDataMap> {
	const queryData: QueryDataMap = {};
	await Promise.all(
		[...extractQueryIds(code)].map(async (queryId) => {
			const result = await chatQueries.getQueryResultByQueryId(chatId, queryId);
			if (result) {
				queryData[queryId] = { data: result.data, columns: result.columns };
			}
		}),
	);
	return queryData;
}

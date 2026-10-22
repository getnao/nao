import * as chatQueries from '../queries/chat.queries';
import type { UIMessage, UIMessagePart } from '../types/chat';

/** `files` marks a custom story, whose content lives in its files rather than in `code`. */
export async function pinStoryMessageToChat(args: {
	chatId: string;
	slug: string;
	title: string;
	code: string;
	version: number;
	files?: string[];
}): Promise<void> {
	const { chatId, slug, title, code, version, files } = args;
	const customFields = files ? { format: 'custom' as const, files } : {};

	await chatQueries.upsertMessage({
		chatId,
		role: 'assistant',
		parts: [
			{
				type: 'tool-story',
				toolCallId: crypto.randomUUID(),
				toolName: 'story',
				state: 'output-available',
				input: { action: 'create', id: slug, title, code, ...(files && { format: 'custom' as const }) },
				output: { _version: '1', success: true, id: slug, version, code, title, ...customFields },
				errorText: undefined,
				providerExecuted: false,
			} as UIMessagePart,
		],
	});
}

export type StoryQueryDataMap = Record<string, { data: unknown[]; columns: string[] }>;

export async function pinQueryDataToChat(chatId: string, queryData: StoryQueryDataMap): Promise<void> {
	const parts = buildQueryDataParts(queryData);
	if (parts.length === 0) {
		return;
	}

	await chatQueries.upsertMessage({
		chatId,
		role: 'assistant',
		isForked: true,
		parts,
	});
}

export function buildQueryDataMessages(queryData: StoryQueryDataMap | null | undefined): Array<Omit<UIMessage, 'id'>> {
	const parts = buildQueryDataParts(queryData);
	if (parts.length === 0) {
		return [];
	}
	return [{ role: 'assistant', isForked: true, parts }];
}

export function buildQueryDataParts(queryData: StoryQueryDataMap | null | undefined): UIMessagePart[] {
	if (!queryData) {
		return [];
	}
	return Object.entries(queryData).map(
		([queryId, { data, columns }]) =>
			({
				type: 'tool-execute_sql',
				toolName: 'execute_sql',
				toolCallId: crypto.randomUUID(),
				state: 'output-available',
				input: { sql_query: '' },
				output: { id: queryId as `query_${string}`, data, columns, row_count: data.length },
				providerExecuted: false,
				errorText: undefined,
			}) as unknown as UIMessagePart,
	);
}

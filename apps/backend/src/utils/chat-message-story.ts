import * as chatQueries from '../queries/chat.queries';
import type { UIMessagePart } from '../types/chat';

export async function pinStoryMessageToChat(args: {
	chatId: string;
	slug: string;
	title: string;
	code: string;
	version: number;
}): Promise<void> {
	const { chatId, slug, title, code, version } = args;

	await chatQueries.upsertMessage({
		chatId,
		role: 'assistant',
		parts: [
			{
				type: 'tool-story',
				toolCallId: crypto.randomUUID(),
				toolName: 'story',
				state: 'output-available',
				input: { action: 'create', id: slug, title, code },
				output: { _version: '1', success: true, id: slug, version, code, title },
				errorText: undefined,
				providerExecuted: false,
			} as UIMessagePart,
		],
	});
}

export type StoryQueryDataMap = Record<string, { data: unknown[]; columns: string[] }>;
export type StoryQueryDefinitionMap = Record<string, { sqlQuery: string; databaseId?: string }>;

export async function pinQueryDataToChat(
	chatId: string,
	queryData: StoryQueryDataMap,
	queryDefinitions: StoryQueryDefinitionMap = {},
): Promise<void> {
	const parts = buildQueryDataParts(queryData, queryDefinitions);
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

export function buildQueryDataParts(
	queryData: StoryQueryDataMap | null | undefined,
	queryDefinitions: StoryQueryDefinitionMap = {},
): UIMessagePart[] {
	if (!queryData) {
		return [];
	}
	return Object.entries(queryData).map(([queryId, { data, columns }]) => {
		const definition = queryDefinitions[queryId];
		return {
			type: 'tool-execute_sql',
			toolName: 'execute_sql',
			toolCallId: crypto.randomUUID(),
			state: 'output-available',
			input: {
				sql_query: definition?.sqlQuery ?? '',
				...(definition?.databaseId && { database_id: definition.databaseId }),
			},
			output: { id: queryId as `query_${string}`, data, columns, row_count: data.length },
			providerExecuted: false,
			errorText: undefined,
		} as unknown as UIMessagePart;
	});
}

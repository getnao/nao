import * as chatQueries from '../queries/chat.queries';
import type { StoredSqlQuery } from '../queries/execute-sql.queries';
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

export type StoryQuerySource = Pick<StoredSqlQuery, 'sqlQuery' | 'databaseId' | 'dialect' | 'semanticQuery'>;

/** A query whose source is unknown keeps an empty SQL, like the data cache of a standalone story. */
export function buildQueryDataMessages(
	queryData: StoryQueryDataMap | null | undefined,
	queries: Record<string, StoryQuerySource> = {},
): Array<Omit<UIMessage, 'id'>> {
	const parts = buildQueryDataParts(queryData, queries);
	if (parts.length === 0) {
		return [];
	}
	return [{ role: 'assistant', isForked: true, parts }];
}

export function buildQueryDataParts(
	queryData: StoryQueryDataMap | null | undefined,
	queries: Record<string, StoryQuerySource> = {},
): UIMessagePart[] {
	if (!queryData) {
		return [];
	}
	return Object.entries(queryData).map(([queryId, result]) =>
		buildQueryPart(queryId, queries[queryId] ?? { sqlQuery: '' }, result),
	);
}

/** A semantic query stays one, so it keeps compiling with the semantic layer's current definitions. */
export function buildQueryPart(
	queryId: string,
	query: StoryQuerySource,
	result: { data: unknown[]; columns: string[] },
): UIMessagePart {
	const output = {
		id: queryId,
		data: result.data,
		columns: result.columns,
		row_count: result.data.length,
		...(query.dialect && { dialect: query.dialect }),
	};
	const toolPart = query.semanticQuery
		? {
				type: 'tool-execute_semantic_query',
				toolName: 'execute_semantic_query',
				input: query.semanticQuery,
				output: { ...output, compiled_sql: query.sqlQuery, database_id: query.databaseId },
			}
		: {
				type: 'tool-execute_sql',
				toolName: 'execute_sql',
				input: { sql_query: query.sqlQuery, ...(query.databaseId && { database_id: query.databaseId }) },
				output,
			};
	return {
		...toolPart,
		toolCallId: crypto.randomUUID(),
		state: 'output-available',
		providerExecuted: false,
		errorText: undefined,
	} as unknown as UIMessagePart;
}

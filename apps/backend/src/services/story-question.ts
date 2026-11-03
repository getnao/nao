import { toStoryReferenceMentionId } from '@nao/shared';

import * as chatQueries from '../queries/chat.queries';
import * as executeSqlQueries from '../queries/execute-sql.queries';
import * as storyReferenceQueries from '../queries/story-reference.queries';
import type { ForkMetadata, UIMessage, UIMessagePart } from '../types/chat';
import type { LinkedStory, QueryResult } from '../types/tools';

type MessageLike = Omit<UIMessage, 'id'>;

/** The story a quick question is about, editable from it by the story's owner only. */
export async function resolveLinkedStory(chat: {
	userId: string;
	projectId: string;
	forkMetadata?: ForkMetadata | null;
}): Promise<LinkedStory | undefined> {
	if (chat.forkMetadata?.type !== 'story_question') {
		return undefined;
	}
	const story = await storyReferenceQueries.getReferenceableStory(chat.userId, chat.projectId, chat.forkMetadata.id);
	if (!story?.chatId) {
		return undefined;
	}
	return {
		storyId: story.storyId,
		chatId: story.chatId,
		slug: story.slug,
		title: story.title,
		format: story.format,
		canEdit: story.ownerId === chat.userId,
	};
}

/**
 * A quick question references its story from its first message, so the story's latest content reaches the
 * agent through the referenced story block on every turn, like a story the user @-mentions.
 */
export function addStoryQuestionReference<T extends MessageLike>(
	messages: T[],
	forkMetadata: ForkMetadata | null | undefined,
): T[] {
	if (forkMetadata?.type !== 'story_question') {
		return messages;
	}
	const firstUserMessageIndex = messages.findIndex((message) => message.role === 'user');
	if (firstUserMessageIndex === -1) {
		return messages;
	}
	const reference: UIMessagePart = {
		type: 'text',
		text: `This question is about the story @[${toStoryReferenceMentionId(forkMetadata.id)}].`,
	};
	return messages.map((message, index) =>
		index === firstUserMessageIndex ? { ...message, parts: [reference, ...message.parts] } : message,
	);
}

export async function copyQueriesToStoryChat(
	question: { chatId: string; queryResults: Map<string, QueryResult>; adminMode?: boolean },
	storyChatId: string,
	queryIds: Set<string>,
): Promise<void> {
	const currentTurnIds = question.adminMode ? [] : [...queryIds].filter((queryId) => runThisTurn(question, queryId));
	const storedIds = new Set([...queryIds].filter((queryId) => !currentTurnIds.includes(queryId)));
	const parts = [
		...currentTurnIds.map((queryId) => fromCurrentTurn(queryId, question.queryResults.get(queryId)!)),
		...(await fromStoredQueriesOutdatedInStoryChat(question.chatId, storyChatId, storedIds)),
	];
	if (parts.length > 0) {
		await chatQueries.upsertMessage({ chatId: storyChatId, role: 'assistant', isForked: true, parts });
	}
}

function runThisTurn(question: { queryResults: Map<string, QueryResult> }, queryId: string): boolean {
	return question.queryResults.get(queryId)?.sqlQuery !== undefined;
}

function fromCurrentTurn(queryId: string, result: QueryResult): UIMessagePart {
	return toQueryPart(
		queryId,
		{ sqlQuery: result.sqlQuery!, databaseId: result.databaseId, semanticQuery: result.semanticQuery },
		result,
	);
}

/** A query the question re-ran under the same id in an earlier turn must replace the story chat's older version. */
async function fromStoredQueriesOutdatedInStoryChat(
	chatId: string,
	storyChatId: string,
	queryIds: Set<string>,
): Promise<UIMessagePart[]> {
	if (queryIds.size === 0) {
		return [];
	}
	const [sqlByChat, dataById] = await Promise.all([
		executeSqlQueries.getLatestSqlQueriesByChats(
			new Map([
				[chatId, queryIds],
				[storyChatId, queryIds],
			]),
		),
		executeSqlQueries.getLatestSqlQueryDataByIds(chatId, queryIds),
	]);
	const sqlById = sqlByChat.get(chatId) ?? {};
	const storyChatSqlById = sqlByChat.get(storyChatId) ?? {};
	return [...queryIds].flatMap((queryId) => {
		const query = sqlById[queryId];
		const result = dataById[queryId];
		const isOutdated = !isSameQuery(query, storyChatSqlById[queryId]);
		return query && result && !query.adminMode && isOutdated ? [toQueryPart(queryId, query, result)] : [];
	});
}

function isSameQuery(query?: executeSqlQueries.StoredSqlQuery, other?: executeSqlQueries.StoredSqlQuery): boolean {
	return (
		query?.sqlQuery === other?.sqlQuery &&
		query?.databaseId === other?.databaseId &&
		JSON.stringify(query?.semanticQuery) === JSON.stringify(other?.semanticQuery)
	);
}

/** A semantic query stays one in the story chat, so the story keeps compiling it with the current definitions. */
function toQueryPart(
	queryId: string,
	query: Pick<executeSqlQueries.StoredSqlQuery, 'sqlQuery' | 'databaseId' | 'dialect' | 'semanticQuery'>,
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

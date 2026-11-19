import * as chatQueries from '../queries/chat.queries';
import { ChatlessToolContext, QueryResult, ToolContext } from '../types/tools';

/**
 * Resolves a query result by id from the current agent run's in-memory cache,
 * falling back to the chat's persisted message history for queries from
 * earlier turns. Successful DB lookups are cached back into the in-memory
 * map so subsequent accesses within the same agent run avoid the round-trip.
 */
export async function getQueryResult(
	context: ToolContext | ChatlessToolContext,
	queryId: string,
): Promise<QueryResult | null> {
	const cached = context.queryResults.get(queryId);
	if (cached) {
		return cached;
	}
	if (!context.chatId) {
		return null;
	}

	const fromDb = await chatQueries.getQueryResultByQueryId(context.chatId, queryId);
	if (!fromDb) {
		return null;
	}

	context.queryResults.set(queryId, fromDb);
	return fromDb;
}

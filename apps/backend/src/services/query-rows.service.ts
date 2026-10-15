import { type SortDirection, sortTableRows } from '@nao/shared/story-table-utils';

import { getQueryToolOutputInChat } from '../queries/execute-sql.queries';
import type { QueryResult } from '../types/tools';
import { agentService } from './agent';

export interface QueryRowsRequest {
	chatId: string;
	toolCallId: string;
	queryId: string;
	offset: number;
	/** All rows from `offset` when omitted. */
	limit?: number;
	sort?: { column: string; direction: SortDirection };
}

export interface QueryRowsPage {
	columns: string[];
	rows: Record<string, unknown>[];
	totalRows: number;
}

export async function getQueryRowsPage(request: QueryRowsRequest): Promise<QueryRowsPage | null> {
	const result = await findQueryResult(request.chatId, request.toolCallId, request.queryId);
	if (!result) {
		return null;
	}

	const rows = request.sort ? sortTableRows(result.data, request.sort.column, request.sort.direction) : result.data;
	const end = request.limit === undefined ? undefined : request.offset + request.limit;
	return { columns: result.columns, rows: rows.slice(request.offset, end), totalRows: rows.length };
}

/** A query from the turn still running is only in the agent's memory: its part is saved when the turn ends. */
async function findQueryResult(chatId: string, toolCallId: string, queryId: string): Promise<QueryResult | null> {
	const persisted = await getQueryToolOutputInChat(chatId, toolCallId);
	if (persisted?.id === queryId && Array.isArray(persisted.columns) && Array.isArray(persisted.data)) {
		return { columns: persisted.columns, data: persisted.data };
	}
	return agentService.get(chatId)?.getQueryResult(queryId) ?? null;
}

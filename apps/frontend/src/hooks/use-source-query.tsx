import { useMemo } from 'react';
import type { executeSql } from '@nao/shared/tools';
import type { UIMessage } from '@nao/backend/chat';
import type { SourceQuery } from '@/lib/execute-sql-messages';
import { useAgentMessagesSelector } from '@/contexts/agent.provider';
import { areSourceQueriesEqual, findLatestExecuteSqlInMessages } from '@/lib/execute-sql-messages';

const sourceQueriesByMessages = new WeakMap<UIMessage[], Map<string, SourceQuery | null>>();

export function useSourceQuery(queryId: string | undefined): {
	sourceQuery: SourceQuery | null;
	sourceData: executeSql.Output | null;
} {
	const sourceQuery = useAgentMessagesSelector<SourceQuery | null>(
		(messages) => (queryId ? findCachedSourceQuery(messages, queryId) : null),
		areSourceQueriesEqual,
	);
	const sourceData = sourceQuery?.output ?? null;

	return useMemo(() => ({ sourceQuery, sourceData }), [sourceQuery, sourceData]);
}

function findCachedSourceQuery(messages: UIMessage[], queryId: string): SourceQuery | null {
	let sourceQueries = sourceQueriesByMessages.get(messages);
	if (!sourceQueries) {
		sourceQueries = new Map();
		sourceQueriesByMessages.set(messages, sourceQueries);
	}

	if (sourceQueries.has(queryId)) {
		return sourceQueries.get(queryId) ?? null;
	}

	const sourceQuery = findLatestExecuteSqlInMessages(messages, queryId);
	sourceQueries.set(queryId, sourceQuery);
	return sourceQuery;
}

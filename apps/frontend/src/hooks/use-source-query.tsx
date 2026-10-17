import { useMemo } from 'react';
import type { executeSql } from '@nao/shared/tools';
import type { UIMessage } from '@nao/backend/chat';
import type { SourceQuery } from '@/lib/execute-sql-messages';
import { useAgentMessagesSelector } from '@/contexts/agent.provider';
import { areSourceQueriesEqual, findLatestExecuteSqlInMessages } from '@/lib/execute-sql-messages';
import { useFullQueryOutput, useQueryRowsSource } from '@/hooks/use-query-rows';

const sourceQueriesByMessages = new WeakMap<UIMessage[], Map<string, SourceQuery | null>>();

/** `sourceData` holds every row of the result: it stays null while the rows a preview lacks are loading. */
export function useSourceQuery(queryId: string | undefined): {
	sourceQuery: SourceQuery | null;
	sourceData: executeSql.Output | null;
	isLoadingRows: boolean;
} {
	const sourceQuery = useAgentMessagesSelector<SourceQuery | null>(
		(messages) => (queryId ? findCachedSourceQuery(messages, queryId) : null),
		areSourceQueriesEqual,
	);
	const rowsSource = useQueryRowsSource(sourceQuery?.toolCallId, sourceQuery?.output);
	const { output, isLoadingRows } = useFullQueryOutput(sourceQuery?.output ?? null, rowsSource);
	const sourceData = isLoadingRows ? null : output;

	return useMemo(() => ({ sourceQuery, sourceData, isLoadingRows }), [sourceQuery, sourceData, isLoadingRows]);
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

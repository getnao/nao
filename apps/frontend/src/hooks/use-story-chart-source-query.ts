import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { executeSql } from '@nao/shared/tools';
import type { SourceQuery } from '@/lib/execute-sql-messages';

import { useSourceQuery } from '@/hooks/use-source-query';
import { trpc } from '@/main';

interface UseStoryChartSourceQueryOptions {
	queryId: string;
	story?: { chatId: string; storySlug: string };
	columns: string[];
	data: Record<string, unknown>[];
	enabled: boolean;
}

/**
 * The query behind a story chart: the chat's query part when the chat is loaded, otherwise
 * the story's saved query paired with the rows the chart is drawn from.
 */
export function useStoryChartSourceQuery({
	queryId,
	story,
	columns,
	data,
	enabled,
}: UseStoryChartSourceQueryOptions): SourceQuery | null {
	const { sourceQuery: chatSourceQuery } = useSourceQuery(queryId);
	const storyQuery = useQuery({
		...trpc.story.getQuerySql.queryOptions({
			chatId: story?.chatId ?? '',
			storySlug: story?.storySlug ?? '',
			queryId,
		}),
		enabled: enabled && !chatSourceQuery && Boolean(story),
	});
	const storySqlQuery = storyQuery.data?.sqlQuery;
	const storyDatabaseId = storyQuery.data?.databaseId;
	const storyDialect = storyQuery.data?.dialect;
	const storySemanticQuery = storyQuery.data?.semanticQuery;

	return useMemo(() => {
		if (chatSourceQuery) {
			return chatSourceQuery;
		}
		if (!storySqlQuery) {
			return null;
		}
		return {
			input: { sql_query: storySqlQuery, database_id: storyDatabaseId },
			output: {
				id: queryId as executeSql.Output['id'],
				columns,
				data,
				row_count: data.length,
				dialect: storyDialect,
			},
			...(storySemanticQuery && { semanticQuery: storySemanticQuery }),
		};
	}, [chatSourceQuery, storySqlQuery, storyDatabaseId, storyDialect, storySemanticQuery, queryId, columns, data]);
}

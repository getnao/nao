import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TableServerPagination, TableSort } from '@nao/shared/table-display';
import type { executeSql } from '@nao/shared/tools';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { trpc } from '@/main';

type QueryRow = Record<string, unknown>;

/** Where to load the rows of a query part the chat only holds a preview of. */
export interface QueryRowsSource {
	chatId: string;
	toolCallId: string;
	queryId: string;
	totalRows: number;
}

interface TablePageState {
	toolCallId: string | undefined;
	pageIndex: number;
	pageSize: number;
	sort: TableSort | null;
}

export function useQueryRowsSource(
	toolCallId: string | undefined,
	output: Pick<executeSql.Output, 'id' | 'row_count' | 'is_preview'> | null | undefined,
): QueryRowsSource | undefined {
	const chatId = useOptionalAgentContext()?.chatId;
	return useMemo(() => {
		if (!chatId || !toolCallId || !output?.is_preview) {
			return undefined;
		}
		return { chatId, toolCallId, queryId: output.id, totalRows: output.row_count };
	}, [chatId, toolCallId, output?.id, output?.row_count, output?.is_preview]);
}

/** The whole result: a preview output gets its remaining rows from the server, and is null if they fail to load. */
export function useFullQueryOutput<T extends executeSql.Output>(
	output: T | null,
	source: QueryRowsSource | undefined,
	{ enabled = true }: { enabled?: boolean } = {},
): { output: T | null; isLoadingRows: boolean } {
	const shouldLoad = Boolean(source && enabled);
	const { data, isLoading, isError } = useQuery(
		trpc.chat.getQueryRows.queryOptions(source && shouldLoad ? allRowsInput(source) : skipToken),
	);

	return useMemo(() => {
		if (!output || !data) {
			return { output: shouldLoad && isError ? null : output, isLoadingRows: shouldLoad && isLoading };
		}
		return { output: { ...output, data: data.rows, is_preview: false }, isLoadingRows: false };
	}, [output, data, shouldLoad, isLoading, isError]);
}

/** For actions that need every row on demand, such as exports. Shares its cache with `useFullQueryOutput`. */
export function useLoadAllQueryRows(source: QueryRowsSource | undefined): (() => Promise<QueryRow[]>) | undefined {
	const queryClient = useQueryClient();
	const loadAllRows = useCallback(async () => {
		if (!source) {
			return [];
		}
		const page = await queryClient.fetchQuery(trpc.chat.getQueryRows.queryOptions(allRowsInput(source)));
		return page.rows;
	}, [queryClient, source]);

	return source ? loadAllRows : undefined;
}

/** Pages within the preview are served from it; the others, and every sorted page, come from the server. */
export function useServerPaginatedRows(
	source: QueryRowsSource | undefined,
	previewRows: QueryRow[],
	initialPageSize: number,
): { rows: QueryRow[]; isLoadingRows: boolean; serverPagination: TableServerPagination | undefined } {
	const toolCallId = source?.toolCallId;
	const firstPage: TablePageState = { toolCallId, pageIndex: 0, pageSize: initialPageSize, sort: null };
	const [storedPage, setStoredPage] = useState<TablePageState>(firstPage);
	const page = storedPage.toolCallId === toolCallId ? storedPage : firstPage;
	const updatePage = (changes: Partial<TablePageState>) => setStoredPage({ ...page, ...changes });
	const offset = page.pageIndex * page.pageSize;
	const isWithinPreview = !page.sort && offset + page.pageSize <= previewRows.length;

	const { data, isLoading } = useQuery({
		...trpc.chat.getQueryRows.queryOptions(
			source && !isWithinPreview
				? {
						chatId: source.chatId,
						toolCallId: source.toolCallId,
						queryId: source.queryId,
						offset,
						limit: page.pageSize,
						sort: page.sort ?? undefined,
					}
				: skipToken,
		),
		placeholderData: keepPreviousData,
	});

	if (!source) {
		return { rows: previewRows, isLoadingRows: false, serverPagination: undefined };
	}

	return {
		rows: isWithinPreview ? previewRows.slice(offset, offset + page.pageSize) : (data?.rows ?? []),
		isLoadingRows: isLoading,
		serverPagination: {
			totalRows: source.totalRows,
			pageIndex: page.pageIndex,
			pageSize: page.pageSize,
			sort: page.sort,
			onPageChange: (pageIndex) => updatePage({ pageIndex }),
			onPageSizeChange: (pageSize) => updatePage({ pageSize, pageIndex: 0 }),
			onSortChange: (sort) => updatePage({ sort, pageIndex: 0 }),
		},
	};
}

function allRowsInput(source: QueryRowsSource) {
	return { chatId: source.chatId, toolCallId: source.toolCallId, queryId: source.queryId, offset: 0 };
}

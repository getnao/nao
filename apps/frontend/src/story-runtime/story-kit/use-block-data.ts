import { useMemo } from 'react';

import { columnsOf } from './columns';
import { useQueryData, useSql } from './hooks';
import type { Row } from './columns';
import type { StoryQueryInputs } from '@nao/shared/story-query-inputs';

export type { Row } from './columns';

export interface BlockDataSource extends StoryQueryInputs {
	queryId?: string;
	/** SQL the block runs itself, as the viewer, instead of a saved query. */
	sql?: string;
	databaseId?: string;
	/** A null while the story's own rows load counts as no array, so the block falls back to its query. */
	data?: Row[] | null;
}

export type BlockData =
	| { status: 'loading'; rows: null; columns: null; error: null }
	| { status: 'error'; rows: null; columns: null; error: string }
	| { status: 'ready'; rows: Row[]; columns: string[]; error: null };

/**
 * Rows come from a saved query by id (re-run with `filters` and `params` when given), from SQL the block runs
 * (its filter blocks rendered with `filters`), or from an array the story computed itself; the array wins, then the SQL.
 */
export function useBlockData({
	queryId,
	sql,
	databaseId,
	data,
	filters,
	params,
}: BlockDataSource): BlockData & { refetch: () => void } {
	const hasData = data !== undefined && data !== null;
	const usesSql = !hasData && sql !== undefined;
	const usesQuery = !hasData && !usesSql && queryId !== undefined;
	const sqlResult = useSql(sql ?? '', { databaseId, filters, enabled: usesSql });
	const queryResult = useQueryData(queryId ?? '', { enabled: usesQuery, filters, params });
	const result = usesSql ? sqlResult : queryResult;
	const resultRows = useMemo(() => result.data?.filter(isRow) ?? [], [result.data]);

	if (hasData) {
		return { status: 'ready', rows: data, columns: columnsOf(data), error: null, refetch: noop };
	}
	if (!usesSql && !usesQuery) {
		return {
			status: 'error',
			rows: null,
			columns: null,
			error: 'Pass a queryId, sql or a data array.',
			refetch: noop,
		};
	}
	if (result.status === 'loading') {
		return { status: 'loading', rows: null, columns: null, error: null, refetch: result.refetch };
	}
	if (result.status === 'error') {
		return { status: 'error', rows: null, columns: null, error: result.error, refetch: result.refetch };
	}
	return {
		status: 'ready',
		rows: resultRows,
		columns: result.columns.length > 0 ? result.columns : columnsOf(resultRows),
		error: null,
		refetch: result.refetch,
	};
}

function isRow(value: unknown): value is Row {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function noop(): void {}

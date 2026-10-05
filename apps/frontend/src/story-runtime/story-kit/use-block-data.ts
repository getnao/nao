import { columnsOf } from './columns';
import { useQueryData } from './hooks';
import type { Row } from './columns';

export type { Row } from './columns';

export interface BlockDataSource {
	queryId?: string;
	data?: Row[];
}

export type BlockData =
	| { status: 'loading'; rows: null; columns: null; error: null }
	| { status: 'error'; rows: null; columns: null; error: string }
	| { status: 'ready'; rows: Row[]; columns: string[]; error: null };

/** Rows come from a chat query by id, or from an array the story computed itself; the latter wins when both are given. */
export function useBlockData({ queryId, data }: BlockDataSource): BlockData & { refetch: () => void } {
	const query = useQueryData(queryId ?? '', { enabled: data === undefined && queryId !== undefined });

	if (data !== undefined) {
		return { status: 'ready', rows: data, columns: columnsOf(data), error: null, refetch: noop };
	}
	if (queryId === undefined) {
		return { status: 'error', rows: null, columns: null, error: 'Pass a queryId or a data array.', refetch: noop };
	}
	if (query.status === 'loading') {
		return { status: 'loading', rows: null, columns: null, error: null, refetch: query.refetch };
	}
	if (query.status === 'error') {
		return { status: 'error', rows: null, columns: null, error: query.error, refetch: query.refetch };
	}
	const rows = query.data.filter(isRow);
	return {
		status: 'ready',
		rows,
		columns: query.columns.length > 0 ? query.columns : columnsOf(rows),
		error: null,
		refetch: query.refetch,
	};
}

function isRow(value: unknown): value is Row {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function noop(): void {}

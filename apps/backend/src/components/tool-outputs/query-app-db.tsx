import { pluralize } from '@nao/shared';

import type { QueryAppDbResult } from '../../agents/tools/query-app-db';
import { Block, ListItem, Span, Title, TitledList } from '../../lib/markdown';
import { formatRowValue, QueryRows } from './query-rows';

const MAX_ROWS = 100;
const MAX_VALUE_LENGTH = 1_000;
const MAX_ROWS_CHARACTERS = 30_000;
const ROW_LINE_OVERHEAD = ': \n'.length;

/**
 * App-db views hold whole conversations (message text, tool inputs and outputs), so the
 * rows sent back to the model are bounded by count, value length and total size.
 */
export const QueryAppDbOutput = ({
	output,
	maxRows = MAX_ROWS,
	maxValueLength = MAX_VALUE_LENGTH,
	maxRowsCharacters = MAX_ROWS_CHARACTERS,
}: {
	output: QueryAppDbResult;
	maxRows?: number;
	maxValueLength?: number;
	maxRowsCharacters?: number;
}) => {
	if (output.rows.length === 0) {
		return <Block>The query was successfully executed and returned no rows.</Block>;
	}

	const valueLength = fitValueLength(output.columns, maxValueLength, maxRowsCharacters);
	const visibleRows = selectVisibleRows(output.rows, { maxRows, valueLength, maxRowsCharacters });
	const hiddenRowCount = output.rows.length - visibleRows.length;
	const hasTruncatedValues = visibleRows.some((row) => hasValueLongerThan(row, valueLength));

	return (
		<Block>
			<TitledList title={`${pluralize('Column', output.columns.length)} (${output.columns.length})`}>
				{output.columns.map((column, index) => (
					<ListItem key={`${column}-${index}`}>{column}</ListItem>
				))}
			</TitledList>

			<Title>
				{pluralize('Row', output.rowCount)} ({output.rowCount})
			</Title>

			<QueryRows rows={visibleRows} maxValueLength={valueLength} />

			{hiddenRowCount > 0 && (
				<Span>
					...({hiddenRowCount} more rows not shown to keep the context small. Narrow the query with WHERE,
					aggregate it, select fewer columns or page through it with LIMIT/OFFSET.)
				</Span>
			)}

			{hasTruncatedValues && (
				<Span>
					Values longer than {valueLength} characters are truncated in the middle. Select a substring of the
					column (e.g. substr(tool_output, 1, 2000)) to read a specific part.
				</Span>
			)}
		</Block>
	);
};

/** Shrinks the per-value length of wide results so that a single row always fits the character budget. */
function fitValueLength(columns: string[], maxValueLength: number, maxRowsCharacters: number): number {
	if (columns.length === 0) {
		return maxValueLength;
	}
	const columnLinesLength = columns.reduce((total, column) => total + column.length + ROW_LINE_OVERHEAD, 0);
	const availableForValues = Math.max(0, maxRowsCharacters - columnLinesLength);
	return Math.min(maxValueLength, Math.floor(availableForValues / columns.length));
}

function selectVisibleRows(
	rows: Record<string, unknown>[],
	limits: { maxRows: number; valueLength: number; maxRowsCharacters: number },
): Record<string, unknown>[] {
	const visibleRows: Record<string, unknown>[] = [];
	let characterCount = 0;
	for (const row of rows.slice(0, limits.maxRows)) {
		characterCount += measureRow(row, limits.valueLength);
		if (characterCount > limits.maxRowsCharacters) {
			break;
		}
		visibleRows.push(row);
	}
	return visibleRows;
}

function measureRow(row: Record<string, unknown>, valueLength: number): number {
	return Object.entries(row).reduce(
		(total, [key, value]) => total + key.length + ROW_LINE_OVERHEAD + formatRowValue(value, valueLength).length,
		0,
	);
}

function hasValueLongerThan(row: Record<string, unknown>, maxLength: number): boolean {
	return Object.values(row).some((value) => formatRowValue(value, Infinity).length > maxLength);
}

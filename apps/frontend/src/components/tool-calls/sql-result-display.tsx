import { TableDisplay } from './display-table';
import type { ColumnConditionalFormats } from '@nao/shared/conditional-formatting';
import type { executeSql } from '@nao/shared/tools';
import type { QueryRowsSource } from '@/hooks/use-query-rows';
import { useFullQueryOutput, useServerPaginatedRows } from '@/hooks/use-query-rows';

const PAGE_SIZE = 10;

interface SqlResultDisplayProps {
	output: executeSql.Output;
	rowsSource?: QueryRowsSource;
	conditionalFormats?: ColumnConditionalFormats;
}

/** Conditional formatting scales colors over every row, so it switches the table to the full result. */
export function SqlResultDisplay({ output, rowsSource, conditionalFormats }: SqlResultDisplayProps) {
	const needsAllRows = Object.keys(conditionalFormats ?? {}).length > 0;
	const fullResult = useFullQueryOutput(output, rowsSource, { enabled: needsAllRows });
	const pagedRows = useServerPaginatedRows(
		needsAllRows ? undefined : rowsSource,
		output.data as Record<string, unknown>[],
		PAGE_SIZE,
	);
	const rows = needsAllRows ? ((fullResult.output ?? output).data as Record<string, unknown>[]) : pagedRows.rows;
	const isLoadingRows = needsAllRows ? fullResult.isLoadingRows : pagedRows.isLoadingRows;

	return (
		<TableDisplay
			data={rows}
			serverPagination={needsAllRows ? undefined : pagedRows.serverPagination}
			columns={output.columns}
			tableContainerClassName='max-h-80 rounded-none border-0 bg-transparent'
			maxRowsBeforePagination={PAGE_SIZE}
			emptyLabel={isLoadingRows ? 'Loading rows...' : undefined}
			compactFooter
			conditionalFormats={conditionalFormats}
		/>
	);
}

import { TableDisplay } from './display-table';
import type { ColumnConditionalFormats } from '@nao/shared/conditional-formatting';
import type { executeSql } from '@nao/shared/tools';

interface SqlResultDisplayProps {
	output: Pick<executeSql.Output, 'columns' | 'data'>;
	conditionalFormats?: ColumnConditionalFormats;
}

export function SqlResultDisplay({ output, conditionalFormats }: SqlResultDisplayProps) {
	return (
		<TableDisplay
			data={output.data as Record<string, unknown>[]}
			columns={output.columns}
			tableContainerClassName='max-h-80 rounded-none border-0 bg-transparent'
			maxRowsBeforePagination={10}
			compactFooter
			conditionalFormats={conditionalFormats}
		/>
	);
}

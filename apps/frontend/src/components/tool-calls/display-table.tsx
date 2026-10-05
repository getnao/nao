import { createCellBackgroundResolver } from '@nao/shared/conditional-formatting';
import { TableDisplay as SharedTableDisplay } from '@nao/shared/table-display';
import { memo, useMemo } from 'react';
import type { TableDisplayProps as SharedTableDisplayProps, TablePaginationProps } from '@nao/shared/table-display';
import type { ColumnConditionalFormats } from '@nao/shared/conditional-formatting';

import { TablePagination } from '@/components/ui/table-pagination';
import { TablePaginationCompact } from '@/components/ui/table-pagination-compact';
import { useDateFormat } from '@/hooks/use-date-format';
import { cn } from '@/lib/utils';

type TableDisplayProps = Omit<SharedTableDisplayProps, 'dateFormat' | 'renderPagination' | 'cellBackground' | 'cn'> & {
	conditionalFormats?: ColumnConditionalFormats;
};

export const TableDisplay = memo(function TableDisplay({ conditionalFormats, ...props }: TableDisplayProps) {
	const dateFormat = useDateFormat();
	const cellBackground = useMemo(
		() => createCellBackgroundResolver(props.data, conditionalFormats),
		[props.data, conditionalFormats],
	);
	return (
		<SharedTableDisplay
			{...props}
			dateFormat={dateFormat}
			cellBackground={cellBackground}
			renderPagination={renderPagination}
			cn={cn}
		/>
	);
});

function renderPagination({ compact, ...pagination }: TablePaginationProps & { compact: boolean }) {
	return compact ? <TablePaginationCompact {...pagination} /> : <TablePagination {...pagination} />;
}

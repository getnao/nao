import { createCellBackgroundResolver } from '@nao/shared/conditional-formatting';
import { TableDisplay as SharedTableDisplay } from '@nao/shared/table-display';
import { memo, useMemo } from 'react';
import type { TableDisplayProps as SharedTableDisplayProps, TablePaginationProps } from '@nao/shared/table-display';
import type { ColumnConditionalFormats } from '@nao/shared/conditional-formatting';

import { TablePagination } from '@/components/ui/table-pagination';
import { TablePaginationCompact } from '@/components/ui/table-pagination-compact';
import { useDateFormat } from '@/hooks/use-date-format';
import { cn } from '@/lib/utils';

type CellBackgroundResolver = NonNullable<SharedTableDisplayProps['cellBackground']>;

type TableDisplayProps = Omit<SharedTableDisplayProps, 'dateFormat' | 'renderPagination' | 'cellBackground' | 'cn'> & {
	conditionalFormats?: ColumnConditionalFormats;
	cellBackground?: CellBackgroundResolver;
};

export const TableDisplay = memo(function TableDisplay({
	conditionalFormats,
	cellBackground,
	...props
}: TableDisplayProps) {
	const dateFormat = useDateFormat();
	const resolveCellBackground = useMemo(() => {
		const conditionalBackground = createCellBackgroundResolver(props.data, conditionalFormats);
		return combineCellBackgrounds(cellBackground, conditionalBackground);
	}, [props.data, conditionalFormats, cellBackground]);
	return (
		<SharedTableDisplay
			{...props}
			dateFormat={dateFormat}
			cellBackground={resolveCellBackground}
			renderPagination={renderPagination}
			cn={cn}
		/>
	);
});

function combineCellBackgrounds(
	primary: CellBackgroundResolver | undefined,
	fallback: CellBackgroundResolver | undefined,
): CellBackgroundResolver | undefined {
	if (!primary) {
		return fallback;
	}
	if (!fallback) {
		return primary;
	}
	return (column, value) => primary(column, value) ?? fallback(column, value);
}

function renderPagination({ compact, ...pagination }: TablePaginationProps & { compact: boolean }) {
	return compact ? <TablePaginationCompact {...pagination} /> : <TablePagination {...pagination} />;
}

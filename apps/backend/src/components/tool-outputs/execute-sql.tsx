import { pluralize } from '@nao/shared';
import type { executeSql } from '@nao/shared/tools';

import { Block, ListItem, Span, Title, TitledList } from '../../lib/markdown';
import { QueryRows } from './query-rows';

const MAX_ROWS = 40;

export const ExecuteSqlOutput = ({ output, maxRows = MAX_ROWS }: { output: executeSql.Output; maxRows?: number }) => {
	if (output.data.length === 0) {
		return <Block>The query was successfully executed and returned no rows.</Block>;
	}

	const isTruncated = output.data.length > maxRows;
	const visibleRows = isTruncated ? output.data.slice(0, maxRows) : output.data;
	const remainingRows = isTruncated ? output.data.length - maxRows : 0;

	const isLimitReached =
		output.applied_limit !== undefined && output.row_count >= output.applied_limit && output.row_count > 0;

	return (
		<Block>
			<Span>Query ID: {output.id}</Span>

			<TitledList title={`${pluralize('Column', output.columns.length)} (${output.columns.length})`}>
				{output.columns.map((column) => (
					<ListItem>{column}</ListItem>
				))}
			</TitledList>

			<Title>
				{pluralize('Row', output.row_count)} ({output.row_count})
			</Title>

			{isLimitReached && (
				<Span>
					Warning: this query returned exactly {output.applied_limit} rows, the maximum allowed by its
					LIMIT/TOP clause, so the result is almost certainly truncated. This row count reflects the LIMIT,
					NOT the total number of matching rows — do not report it as a total or "exact" count. To get the
					true total, run a separate query with COUNT(*) (or COUNT over a subquery) and no LIMIT/TOP clause.
				</Span>
			)}

			<QueryRows rows={visibleRows} />

			{remainingRows > 0 && (
				<Span>
					...({remainingRows} more — call read_query_result with query_id "{output.id}" and offset {maxRows}{' '}
					to see more)
				</Span>
			)}
		</Block>
	);
};

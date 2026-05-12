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

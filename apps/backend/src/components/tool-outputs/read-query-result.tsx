import { pluralize } from '@nao/shared';
import type { readQueryResult } from '@nao/shared/tools';

import { Block, ListItem, Span, Title, TitledList } from '../../lib/markdown';
import { QueryRows } from './query-rows';

export const ReadQueryResultOutput = ({ output }: { output: readQueryResult.Output }) => {
	const { id, columns, data, row_count, offset } = output;

	if (row_count === 0) {
		return <Block>{`The query result for ${id} contains no rows.`}</Block>;
	}

	if (data.length === 0) {
		return (
			<Block>
				<Span>Query ID: {id}</Span>
				<Span>
					Offset {offset} is past the end of the result ({row_count} total rows).
				</Span>
			</Block>
		);
	}

	const end = offset + data.length;
	const remaining = row_count - end;

	return (
		<Block>
			<Span>Query ID: {id}</Span>

			<TitledList title={`${pluralize('Column', columns.length)} (${columns.length})`}>
				{columns.map((column, i) => (
					<ListItem key={`${i}:${column}`}>{column}</ListItem>
				))}
			</TitledList>

			<Title>
				{pluralize('Row', data.length)} {offset + 1}–{end} of {row_count}
			</Title>

			<QueryRows rows={data} startIndex={offset} />

			{remaining > 0 && (
				<Span>
					...({remaining} more — call read_query_result again with offset {end} to see more)
				</Span>
			)}
		</Block>
	);
};

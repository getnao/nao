import { pluralize } from '@nao/shared';
import type { executeSql } from '@nao/shared/tools';

import { Block, CodeBlock, ListItem, Span, Title, TitledList } from '../../lib/markdown';
import { truncateMiddle } from '../../utils/utils';

const MAX_ROWS = 20;

export const ExecuteSqlOutput = ({ output }: { output: executeSql.Output }) => {
	if (output.data.length === 0) {
		return <Block>The query was successfully executed and returned no rows.</Block>;
	}

	const isTruncated = output.data.length > MAX_ROWS;
	const visibleRows = isTruncated ? output.data.slice(0, MAX_ROWS) : output.data;
	const remainingRows = isTruncated ? output.data.length - MAX_ROWS : 0;

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

			<Block>
				{visibleRows.map((row, i) => (
					<CodeBlock header={`#${i + 1}`}>
						<Block separator={'\n'}>
							{Object.entries(row).map(([key, value]) => `${key}: ${formatRowValue(value)}`)}
						</Block>
					</CodeBlock>
				))}
			</Block>

			{remainingRows > 0 && <Span>...({remainingRows} more)</Span>}
		</Block>
	);
};

const formatRowValue = (value: unknown) => {
	let strValue = '';
	if (typeof value === 'object') {
		strValue = JSON.stringify(value);
	} else {
		strValue = String(value);
	}
	return truncateMiddle(strValue, 255);
};

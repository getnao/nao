import { Block, CodeBlock } from '../../lib/markdown';
import { truncateMiddle } from '../../utils/utils';

/**
 * Renders an array of query rows as a sequence of code blocks, one per row.
 * `startIndex` controls the row number shown in the header (1-based).
 */
export const QueryRows = ({ rows, startIndex = 0 }: { rows: Record<string, unknown>[]; startIndex?: number }) => {
	return (
		<Block>
			{rows.map((row, i) => (
				<CodeBlock key={startIndex + i} header={`#${startIndex + i + 1}`}>
					<Block separator={'\n'}>
						{Object.entries(row).map(([key, value]) => `${key}: ${formatRowValue(value)}`)}
					</Block>
				</CodeBlock>
			))}
		</Block>
	);
};

const formatRowValue = (value: unknown) => {
	const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
	return truncateMiddle(strValue, 255);
};

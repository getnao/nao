import { Block, CodeBlock } from '../../lib/markdown';
import { truncateMiddle } from '../../utils/utils';

/**
 * Renders an array of query rows as a sequence of code blocks, one per row.
 * `startIndex` controls the row number shown in the header (1-based).
 */
export const QueryRows = ({
	rows,
	startIndex = 0,
	maxValueLength = DEFAULT_MAX_VALUE_LENGTH,
}: {
	rows: Record<string, unknown>[];
	startIndex?: number;
	maxValueLength?: number;
}) => {
	return (
		<Block>
			{rows.map((row, i) => (
				<CodeBlock key={startIndex + i} header={`#${startIndex + i + 1}`}>
					<Block separator={'\n'}>
						{Object.entries(row).map(([key, value]) => `${key}: ${formatRowValue(value, maxValueLength)}`)}
					</Block>
				</CodeBlock>
			))}
		</Block>
	);
};

const DEFAULT_MAX_VALUE_LENGTH = 255;

export const formatRowValue = (value: unknown, maxLength: number = DEFAULT_MAX_VALUE_LENGTH) => {
	const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
	return truncateMiddle(strValue, maxLength);
};

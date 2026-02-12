import { pluralize } from '@nao/shared';
import type { grep } from '@nao/shared/tools';

import { Block, CodeBlock, ListItem, Span, TitledList } from '../../lib/markdown';
import { groupBy, removeNewLine, truncateMiddle } from '../../utils/utils';

const MAX_LINES = 50;
const MAX_MORE_FILES = 10;

export const GrepOutput = ({
	output,
	maxLines = MAX_LINES,
	maxMoreFiles = MAX_MORE_FILES,
}: {
	output: grep.Output;
	maxLines?: number;
	maxMoreFiles?: number;
}) => {
	const { matches, total_matches } = output;

	if (total_matches === 0) {
		return 'No matches found.';
	}

	const displayed = matches.slice(0, maxLines);
	const remaining = matches.slice(maxLines);
	const byFile = groupBy(displayed, (m) => m.path);
	const remainingPaths = [...new Set(remaining.map((m) => m.path))];

	return (
		<Block>
			<Span>
				{pluralize('Match', total_matches)} ({total_matches})
			</Span>
			<Block>
				{Object.entries(byFile).map(([filePath, fileMatches]) => (
					<CodeBlock header={[filePath, `(${fileMatches.length})`]}>
						<Block separator={'\n'}>{fileMatches.map((m) => formatMatch(m))}</Block>
					</CodeBlock>
				))}
			</Block>
			{remainingPaths.length > 0 && (
				<TitledList title='More matches in' maxItems={maxMoreFiles}>
					{remainingPaths.map((p) => (
						<ListItem>{p}</ListItem>
					))}
				</TitledList>
			)}
		</Block>
	);
};

const formatMatch = (match: grep.Match) => {
	return `${match.line_number}:${truncateMiddle(removeNewLine(match.line_content), 64)}`;
};

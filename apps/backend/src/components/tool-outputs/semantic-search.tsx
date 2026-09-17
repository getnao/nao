import type { semanticSearch } from '@nao/shared/tools';

import { Block, List, ListItem, Span } from '../../lib/markdown';

const LOW_COVERAGE = 0.35;

export const SemanticSearchOutput = ({ output }: { output: semanticSearch.Output }) => {
	if (output.candidates === 0) {
		return <Block>No context files under this folder.</Block>;
	}

	return (
		<Block>
			<Span>
				Ranked {output.candidates} candidates. {describeCoverage(output.coverage)}
			</Span>
			{output.results.length > 0 && (
				<List>
					{output.results.map((result) => (
						<ListItem>{formatResult(result)}</ListItem>
					))}
				</List>
			)}
			<Span>
				Relevance is the probability the entry holds what the query needs; read the top ones to confirm.
			</Span>
		</Block>
	);
};

const describeCoverage = (coverage: number): string => {
	if (coverage < LOW_COVERAGE) {
		return `This folder probably does not cover the query (coverage ${formatPercent(coverage)}); look elsewhere or ask the user.`;
	}
	return `The folder likely covers the query (coverage ${formatPercent(coverage)}).`;
};

const formatResult = (result: semanticSearch.Result): string => {
	const kind = result.type === 'directory' ? 'table folder' : 'file';
	const excerpt = result.excerpt ? ` — ${result.excerpt}` : '';
	return `${result.path} (${kind}, ${formatPercent(result.relevance)})${excerpt}`;
};

const formatPercent = (probability: number): string => {
	return `${Math.round(probability * 100)}%`;
};

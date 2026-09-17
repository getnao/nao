import { semanticSearch } from '@nao/shared/tools';

import { renderToModelOutput, SemanticSearchOutput } from '../../components/tool-outputs';
import { collectContextCandidates, rankContextCandidates } from '../../services/context-retrieval';
import { createTool, isStoragePath } from '../../utils/tools';

const DEFAULT_MAX_RESULTS = 8;
const PROJECT_ROOT = '/';

export default createTool<semanticSearch.Input, semanticSearch.Output>({
	description: [
		'Find the context files most relevant to a question. Ranks every file and table folder under a folder by how well it answers the query, using a fast decision model, and returns the top results with a relevance probability.',
		'Use it before grepping many spellings or guessing paths: one call replaces a round of list/grep/search. Scope it with `path` (e.g. /databases, /semantics, /docs) when you know where to look. Then read the top results; for a table folder, read its columns.md.',
		'It searches the project context only, not permanent storage.',
	].join(' '),
	inputSchema: semanticSearch.InputSchema,
	outputSchema: semanticSearch.OutputSchema,
	execute: async ({ query, path = PROJECT_ROOT, max_results = DEFAULT_MAX_RESULTS }, context, { abortSignal }) => {
		if (isStoragePath(path)) {
			throw new Error(
				'semantic_search only covers the project context; use grep or search for permanent storage.',
			);
		}

		const candidates = await collectContextCandidates(path, context.projectFolder);
		const ranking = await rankContextCandidates(query, candidates, { maxResults: max_results, abortSignal });

		return {
			_version: '1',
			results: ranking.results.map(({ candidate, relevance }) => ({
				path: candidate.path,
				type: candidate.type,
				relevance,
				excerpt: candidate.excerpt,
			})),
			candidates: candidates.length,
			coverage: ranking.coverage,
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(SemanticSearchOutput({ output }), output),
});

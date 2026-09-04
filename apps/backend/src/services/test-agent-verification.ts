import type { LlmSelectedModel } from '@nao/shared/types';
import type { ModelMessage } from 'ai';

import { usesGoogleGenerativeAiApi } from '../agents/provider-meta';
import type { QueryResult } from '../types/tools';

export function buildVerificationMessages(
	modelSelection: LlmSelectedModel,
	prompt: string,
	responseMessages: ModelMessage[],
	expectedColumns: string[],
	queryResults: Map<string, QueryResult>,
): ModelMessage[] {
	return [
		...(usesGoogleGenerativeAiApi(modelSelection.provider, modelSelection.modelId)
			? [{ role: 'user' as const, content: prompt }]
			: []),
		...responseMessages,
		{ role: 'user', content: buildVerificationPrompt(expectedColumns, queryResults) },
	];
}

function buildVerificationPrompt(columns: string[], queryResults: Map<string, QueryResult>): string {
	const tables = [...queryResults.entries()]
		.map(([queryId, result]) => `- ${queryId} (${result.data.length} rows): ${result.columns.join(', ')}`)
		.join('\n');

	return `Based on your previous analysis, write a DuckDB query returning the final answer to the original question.

Every query you ran is loaded in DuckDB as a table named after its query id:
${tables}

Rules:
- Only read from the tables above, the warehouse is not reachable anymore.
- Return exactly these columns, with these names: ${columns.join(', ')}
- Read the values from the tables, never retype them as literals.
- Apply the same filters, aggregations and ordering as the answer you gave.
- Set sql to null if these tables cannot answer the question.`;
}

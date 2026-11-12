import { renderSqlTemplate } from '@nao/shared/sql-template';
import {
	type StoryQueryFilterBindings,
	type StoryQueryInputs,
	toStoryFilterBindings,
	withInactiveFilterSpecs,
} from '@nao/shared/story-query-inputs';
import type { ParsedFilterBlock } from '@nao/shared/story-segments';

import * as storyQueries from '../queries/story.queries';
import { createStoryExecutionContext, executeStoryQueries, type StoryQueryResult } from './live-story';
import type { SemanticStoryBindings } from './semantic-story-bindings';

interface StoryQueryInputsExecutionOptions {
	/** Who asked: the rerun runs with their own access, so a filter or a parameter never reaches past it. */
	viewerId: string;
	billingAccessVerifiedProjectId?: string;
}

/**
 * Re-runs a saved query of the chat with the filters and parameters a custom story sent: filters render the
 * query's `{% filter %}` blocks (and filter semantic queries by the dimension of the same name), parameters fill
 * the `{{ params.<id> }}` placeholders of semantic queries. It runs as the viewer, like story SQL: a parameter can
 * switch a semantic query to another metric, which the saved rows never showed.
 */
export async function executeStoryQueryWithInputs(
	chatId: string,
	queryId: string,
	inputs: StoryQueryInputs,
	options: StoryQueryInputsExecutionOptions,
): Promise<StoryQueryResult> {
	const query = await storyQueries.getSqlQueryById(chatId, queryId);
	if (!query) {
		throw new Error(`Query ${queryId} not found in chat ${chatId}`);
	}

	const filterBindings = toStoryFilterBindings(inputs.filters);
	const executionContext = await createStoryExecutionContext(chatId, options.viewerId);
	const queryData = await executeStoryQueries(
		chatId,
		{ [queryId]: query },
		{
			renderSql: (sqlQuery) =>
				renderSqlTemplate(
					sqlQuery,
					filterBindings.selections,
					withInactiveFilterSpecs(sqlQuery, filterBindings.specs),
				),
			semanticBindings: toSemanticBindings(filterBindings, inputs),
			executionContext,
			billingAccessVerifiedProjectId: options.billingAccessVerifiedProjectId,
		},
	);
	return queryData[queryId]!;
}

function toSemanticBindings(filterBindings: StoryQueryFilterBindings, inputs: StoryQueryInputs): SemanticStoryBindings {
	return {
		parameterValues: inputs.params ?? {},
		dimensionFilters: Object.entries(filterBindings.specs).map(
			([filterId, spec]): ParsedFilterBlock => ({
				id: filterId,
				label: filterId,
				filterType: spec.type,
				valueType: spec.valueType,
				dimension: filterId,
			}),
		),
		selections: filterBindings.selections,
	};
}

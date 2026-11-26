import { renderSqlTemplate } from '@nao/shared/sql-template';
import { STORY_QUERY_ACCESS_DENIED_MESSAGE } from '@nao/shared/story-app';
import {
	type StoryQueryFilterBindings,
	type StoryQueryInputs,
	toStoryFilterBindings,
	withInactiveFilterSpecs,
} from '@nao/shared/story-query-inputs';
import type { ParsedFilterBlock } from '@nao/shared/story-segments';

import * as storyQueries from '../queries/story.queries';
import {
	createOwnerExecutionContext,
	createStoryExecutionContext,
	executeStoryQueries,
	resolveChatQueryScope,
	resolveStoryQueryScope,
	type StoryExecutionContext,
	type StoryQueryResult,
	type StoryQueryScope,
	type StorySqlQuery,
} from './live-story';
import type { SemanticStoryBindings } from './semantic-story-bindings';
import { loadStorySqlQueries, type StoryQueryOrigin } from './story-sql-queries';

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

	const [chatScope, executionContext] = await Promise.all([
		resolveChatQueryScope(chatId),
		createStoryExecutionContext(chatId, options.viewerId),
	]);
	const scope = { ...chatScope, ownerId: options.viewerId };
	return executeQueryWithInputs(scope, executionContext, queryId, query, inputs, options);
}

/** Same for a story's own saved query, which a standalone story keeps without a chat; null when it has no SQL saved. */
export async function executeSavedStoryQueryWithInputs(
	story: StoryQueryOrigin,
	queryId: string,
	inputs: StoryQueryInputs,
	options: StoryQueryInputsExecutionOptions,
): Promise<StoryQueryResult | null> {
	const { [queryId]: query } = await loadStorySqlQueries(story, [queryId]);
	if (!query) {
		return null;
	}

	const scope = { ...(await resolveStoryQueryScope(story)), ownerId: options.viewerId };
	const executionContext = await createOwnerExecutionContext(scope);
	return executeQueryWithInputs(scope, executionContext, queryId, query, inputs, options);
}

async function executeQueryWithInputs(
	scope: StoryQueryScope,
	executionContext: StoryExecutionContext,
	queryId: string,
	query: StorySqlQuery,
	inputs: StoryQueryInputs,
	options: StoryQueryInputsExecutionOptions,
): Promise<StoryQueryResult> {
	const filterBindings = toStoryFilterBindings(inputs.filters);
	const queryData = await executeStoryQueries(
		scope,
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
	const result = queryData[queryId];
	if (!result) {
		throw new Error(`Query ${queryId} cannot be rerun with your access, so its filters cannot apply.`);
	}
	if (result.accessDenied) {
		throw new Error(STORY_QUERY_ACCESS_DENIED_MESSAGE);
	}
	return result;
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

import {
	renderSqlTemplate,
	type StoryFilterSelections,
	type StoryFilterSpecById,
	stripSqlFilterBlocks,
} from '@nao/shared/sql-template';
import { resolveSemanticQueryParameters } from '@nao/shared/story-parameter-template';
import { getStoryFiltersFromCode } from '@nao/shared/story-segments';
import { TRPCError } from '@trpc/server';

import { env } from '../env';
import * as storyQueries from '../queries/story.queries';
import { createStoryExecutionContext, executeStoryQueries, type StoryQueryData } from './live-story';
import { compileSemanticQuery, describeSemanticLayerCached, type SemanticQuery } from './semantic-layer.service';
import { bindSemanticQuery, semanticBindingsFromCode } from './semantic-story-bindings';

interface StoryFilterExecutionOptions {
	billingAccessVerifiedProjectId?: string;
}

export function assertStoryFiltersEnabled() {
	if (!env.BETA_STORY_FILTERS_ENABLED) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Story filters are disabled on this instance.' });
	}
}

export async function getFilteredStoryQueryData(
	chatId: string,
	storySlug: string,
	selections: StoryFilterSelections,
	executionOptions: StoryFilterExecutionOptions = {},
): Promise<StoryQueryData> {
	const [{ code, sqlQueries }, executionContext] = await Promise.all([
		loadStoryCodeAndQueries(chatId, storySlug),
		createStoryExecutionContext(chatId),
	]);
	const specs = filterSpecsFromCode(code);

	return executeStoryQueries(chatId, sqlQueries, {
		executionContext,
		renderSql: (sqlQuery) => renderStorySql(sqlQuery, selections, specs),
		semanticBindings: semanticBindingsFromCode(code, selections),
		billingAccessVerifiedProjectId: executionOptions.billingAccessVerifiedProjectId,
	});
}

export async function getStoryQuerySql(
	chatId: string,
	storySlug: string,
	queryId: string,
	selections: StoryFilterSelections = {},
): Promise<{
	sqlQuery: string;
	renderedSql: string;
	databaseId?: string;
	dialect?: string;
	/** The saved query, placeholders included: what editors load and save back. */
	semanticQuery?: SemanticQuery;
	/** Read-only preview of the semantic query as it runs for these selections. */
	effectiveSemanticQuery?: SemanticQuery;
}> {
	const { code, sqlQueries } = await loadStoryCodeAndQueries(chatId, storySlug);
	const query = sqlQueries[queryId];
	if (!query) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Query "${queryId}" not found.` });
	}

	const base = {
		sqlQuery: query.sqlQuery,
		renderedSql: renderStorySql(query.sqlQuery, selections, filterSpecsFromCode(code)),
		databaseId: query.databaseId,
		dialect: query.dialect,
		semanticQuery: query.semanticQuery,
	};
	return query.semanticQuery
		? { ...base, ...(await previewBoundSemanticQuery(chatId, code, query.semanticQuery, selections)) }
		: base;
}

/** The semantic query as it runs for these selections: parameters resolved, dimension filters applied, compiled. */
async function previewBoundSemanticQuery(
	chatId: string,
	code: string,
	semanticQuery: SemanticQuery,
	selections: StoryFilterSelections,
): Promise<{ effectiveSemanticQuery: SemanticQuery; renderedSql?: string }> {
	const { toolContext } = await createStoryExecutionContext(chatId);
	const bound = await bindSemanticQuery(semanticQuery, semanticBindingsFromCode(code, selections), () =>
		describeSemanticLayerCached(toolContext).catch(() => null),
	);
	const effectiveQuery = resolveSemanticQueryParameters(bound.query);
	const compiled = await compileSemanticQuery(effectiveQuery, toolContext).catch(() => null);
	return { effectiveSemanticQuery: effectiveQuery, ...(compiled && { renderedSql: compiled.sql }) };
}

function filterSpecsFromCode(code: string): StoryFilterSpecById {
	return Object.fromEntries(
		getStoryFiltersFromCode(code).map((filter) => [
			filter.id,
			{ type: filter.filterType, valueType: filter.valueType },
		]),
	);
}

function renderStorySql(sqlQuery: string, selections: StoryFilterSelections, specs: StoryFilterSpecById): string {
	return Object.keys(selections).length === 0
		? stripSqlFilterBlocks(sqlQuery)
		: renderSqlTemplate(sqlQuery, selections, specs);
}

async function loadStoryCodeAndQueries(chatId: string, storySlug: string) {
	const version = await storyQueries.getLatestVersionByChatAndSlug(chatId, storySlug);
	if (!version) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}

	const sqlQueries = await storyQueries.getSqlQueriesFromCode(chatId, version.code);

	return {
		code: version.code,
		sqlQueries,
	};
}

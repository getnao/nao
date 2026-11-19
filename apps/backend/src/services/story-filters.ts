import {
	renderSqlTemplate,
	type StoryFilterSelections,
	type StoryFilterSpecById,
	stripSqlFilterBlocks,
} from '@nao/shared/sql-template';
import { resolveSemanticQueryParameters } from '@nao/shared/story-parameter-template';
import { extractQueryIds, getStoryFiltersFromCode } from '@nao/shared/story-segments';
import { TRPCError } from '@trpc/server';

import { env } from '../env';
import type { StoredSqlQuery } from '../queries/execute-sql.queries';
import * as storyQueries from '../queries/story.queries';
import {
	availableStoryQueryData,
	createOwnerExecutionContext,
	createStoryExecutionContext,
	executeStoryQueries,
	requiresViewerStoryData,
	resolveChatQueryScope,
	resolveStoryQueryScope,
	type StoryExecutionContext,
	type StoryQueryData,
	type StoryQueryScope,
} from './live-story';
import { compileSemanticQuery, describeSemanticLayerCached, type SemanticQuery } from './semantic-layer.service';
import { bindSemanticQuery, semanticBindingsFromCode } from './semantic-story-bindings';
import { loadStorySqlQueries } from './story-sql-queries';

interface StoryFilterExecutionOptions {
	billingAccessVerifiedProjectId?: string;
	viewerUserId?: string;
}

interface FilterableStory {
	chatId: string | null;
	code: string;
	sqlQueries: Record<string, StoredSqlQuery>;
	resolveScope: () => Promise<StoryQueryScope>;
	/** Filtered queries run with the access of the story owner. */
	createExecutionContext: () => Promise<StoryExecutionContext>;
}

interface StoryQuerySqlDescription {
	sqlQuery: string;
	renderedSql: string;
	databaseId?: string;
	dialect?: string;
	/** The saved query, placeholders included: what editors load and save back. */
	semanticQuery?: SemanticQuery;
	/** Read-only preview of the semantic query as it runs for these selections. */
	effectiveSemanticQuery?: SemanticQuery;
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
	return executeFilteredQueries(await loadChatFilterableStory(chatId, storySlug), selections, executionOptions);
}

export async function getFilteredStoryQueryDataByStoryId(
	storyId: string,
	selections: StoryFilterSelections,
	executionOptions: StoryFilterExecutionOptions = {},
): Promise<StoryQueryData> {
	return executeFilteredQueries(await loadFilterableStoryById(storyId), selections, executionOptions);
}

export async function getStoryQuerySql(
	chatId: string,
	storySlug: string,
	queryId: string,
	selections: StoryFilterSelections = {},
): Promise<StoryQuerySqlDescription> {
	return describeStoryQuerySql(await loadChatFilterableStory(chatId, storySlug), queryId, selections);
}

export async function getStoryQuerySqlByStoryId(
	storyId: string,
	queryId: string,
	selections: StoryFilterSelections = {},
): Promise<StoryQuerySqlDescription> {
	return describeStoryQuerySql(await loadFilterableStoryById(storyId), queryId, selections);
}

async function executeFilteredQueries(
	story: FilterableStory,
	selections: StoryFilterSelections,
	executionOptions: StoryFilterExecutionOptions,
): Promise<StoryQueryData> {
	const viewerUserId =
		executionOptions.viewerUserId &&
		story.chatId &&
		(await requiresViewerStoryData(story.chatId, executionOptions.viewerUserId))
			? executionOptions.viewerUserId
			: undefined;
	const baseScope = await story.resolveScope();
	const scope = viewerUserId ? { ...baseScope, ownerId: viewerUserId } : baseScope;
	const executionContext =
		viewerUserId && story.chatId
			? await createStoryExecutionContext(story.chatId, viewerUserId)
			: await story.createExecutionContext();
	const specs = filterSpecsFromCode(story.code);

	return availableStoryQueryData(
		await executeStoryQueries(scope, story.sqlQueries, {
			executionContext,
			renderSql: (sqlQuery) => renderStorySql(sqlQuery, selections, specs),
			semanticBindings: semanticBindingsFromCode(story.code, selections),
			billingAccessVerifiedProjectId: executionOptions.billingAccessVerifiedProjectId,
		}),
	);
}

async function describeStoryQuerySql(
	story: FilterableStory,
	queryId: string,
	selections: StoryFilterSelections,
): Promise<StoryQuerySqlDescription> {
	const { code, sqlQueries } = story;
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
		? { ...base, ...(await previewBoundSemanticQuery(story, query.semanticQuery, selections)) }
		: base;
}

/** The semantic query as it runs for these selections: parameters resolved, dimension filters applied, compiled. */
async function previewBoundSemanticQuery(
	story: FilterableStory,
	semanticQuery: SemanticQuery,
	selections: StoryFilterSelections,
): Promise<{ effectiveSemanticQuery: SemanticQuery; renderedSql?: string }> {
	const { toolContext } = await story.createExecutionContext();
	const bound = await bindSemanticQuery(semanticQuery, semanticBindingsFromCode(story.code, selections), () =>
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

async function loadChatFilterableStory(chatId: string, storySlug: string): Promise<FilterableStory> {
	const version = await storyQueries.getLatestVersionByChatAndSlug(chatId, storySlug);
	if (!version) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}

	return {
		chatId,
		code: version.code,
		sqlQueries: await storyQueries.getSqlQueriesFromCode(chatId, version.code),
		resolveScope: () => resolveChatQueryScope(chatId),
		createExecutionContext: () => createStoryExecutionContext(chatId),
	};
}

async function loadFilterableStoryById(storyId: string): Promise<FilterableStory> {
	const [story, version] = await Promise.all([
		storyQueries.getStoryById(storyId),
		storyQueries.getLatestVersionByStoryId(storyId),
	]);
	if (!story || !version) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}

	let scope: Promise<StoryQueryScope> | undefined;
	const resolveScope = () => {
		scope ??= resolveStoryQueryScope(story);
		return scope;
	};
	return {
		chatId: story.chatId,
		code: version.code,
		sqlQueries: await loadStorySqlQueries(story, extractQueryIds(version.code)),
		resolveScope,
		createExecutionContext: async () => createOwnerExecutionContext(await resolveScope()),
	};
}

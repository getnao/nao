import { and, asc, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import {
	alias as pgAlias,
	doublePrecision as pgDoublePrecision,
	pgTable,
	QueryBuilder as PgQueryBuilder,
	text as pgText,
} from 'drizzle-orm/pg-core';
import {
	alias as sqliteAlias,
	QueryBuilder as SqliteQueryBuilder,
	real as sqliteReal,
	type SQLiteColumn,
	sqliteTable,
	text as sqliteText,
} from 'drizzle-orm/sqlite-core';

import dbConfig, { Dialect } from './dbConfig';
import * as pgSchema from './pg-schema';
import * as sqliteSchema from './sqlite-schema';
import { user } from './sqlite-schema';

export interface ScopedView {
	name: string;
	/** The SELECT body the view is created from (no trailing semicolon). */
	body: string;
	/** Columns the view exposes, in select order. Derived from the query, never hand-written. */
	columns: string[];
}

type ViewSchema = typeof sqliteSchema;
type ScopeTable = typeof sqliteScope;
type ModelCostTable = typeof sqliteModelCost;
type AliasFn = typeof sqliteAlias;
type TimestampFn = (column: SQLiteColumn, name: string) => SQL.Aliased<string>;

/** Postgres already stores native timestamps. */
const postgresTimestamp: TimestampFn = (column, name) => sql<string>`${column}`.as(name);

/** SQLite stores epoch milliseconds, which no date function accepts as-is. */
const sqliteTimestamp: TimestampFn = (column, name) => sql<string>`datetime(${column} / 1000, 'unixepoch')`.as(name);

const sqliteScope = sqliteTable('_scope', { projectId: sqliteText('project_id').notNull() });
const pgScope = pgTable('_scope', { projectId: pgText('project_id').notNull() });

/** Price per million tokens of each provider, model and credential, filled per query (see `runScopedAppDbQuery`). */
const sqliteModelCost = sqliteTable('_model_cost', {
	provider: sqliteText('provider').notNull(),
	modelId: sqliteText('model_id').notNull(),
	llmConfigId: sqliteText('llm_config_id').notNull(),
	inputNoCache: sqliteReal('input_no_cache').notNull(),
	inputCacheRead: sqliteReal('input_cache_read').notNull(),
	inputCacheWrite: sqliteReal('input_cache_write').notNull(),
	output: sqliteReal('output').notNull(),
});
const pgModelCost = pgTable('_model_cost', {
	provider: pgText('provider').notNull(),
	modelId: pgText('model_id').notNull(),
	llmConfigId: pgText('llm_config_id').notNull(),
	inputNoCache: pgDoublePrecision('input_no_cache').notNull(),
	inputCacheRead: pgDoublePrecision('input_cache_read').notNull(),
	inputCacheWrite: pgDoublePrecision('input_cache_write').notNull(),
	output: pgDoublePrecision('output').notNull(),
});

/**
 * Project-scoped, read-only views over nao's own usage tables. They are the only
 * surface `query_app_db` can read. The bodies are generated from the Drizzle
 * schema so the exposed columns stay in lockstep with the tables and are never
 * written as raw SQL.
 *
 * Each view filters to the single project id held in the `_scope` temp table
 * (bound via a parameter at runtime, never interpolated into SQL).
 */
export function getScopedViews(): ScopedView[] {
	if (dbConfig.dialect === Dialect.Postgres) {
		return buildScopedViews(
			pgSchema as unknown as ViewSchema,
			pgScope as unknown as ScopeTable,
			pgModelCost as unknown as ModelCostTable,
			new PgQueryBuilder() as unknown as SqliteQueryBuilder,
			pgAlias as unknown as AliasFn,
			postgresTimestamp,
		);
	}
	return buildScopedViews(
		sqliteSchema,
		sqliteScope,
		sqliteModelCost,
		new SqliteQueryBuilder(),
		sqliteAlias,
		sqliteTimestamp,
	);
}

/** View name -> exposed columns. Dialect-independent; safe to use in prompts and allowlists. */
export const APP_DB_VIEW_COLUMNS: Record<string, string[]> = Object.fromEntries(
	getScopedViews().map((view) => [view.name, view.columns]),
);

function buildScopedViews(
	schema: ViewSchema,
	scope: ScopeTable,
	modelCost: ModelCostTable,
	qb: SqliteQueryBuilder,
	alias: AliasFn,
	timestamp: TimestampFn,
): ScopedView[] {
	const {
		chat,
		chatMessage,
		messagePart,
		messageFeedback,
		memories,
		llmInference,
		mcpCallLog,
		project,
		analyticsEvent,
		story,
		storyFeedback,
		testRun,
		testRunResult,
		automation,
		automationRun,
	} = schema;
	const scopedProjectIds = () => qb.select({ projectId: scope.projectId }).from(scope);

	const modelCostOf = (provider: SQLiteColumn, modelId: SQLiteColumn, llmConfigId: SQLiteColumn) =>
		and(
			eq(modelCost.provider, provider),
			eq(modelCost.modelId, modelId),
			eq(modelCost.llmConfigId, sql`coalesce(${llmConfigId}, '')`),
		);
	const costUsd = (tokens: {
		noCache: SQLiteColumn;
		cacheRead: SQLiteColumn;
		cacheWrite: SQLiteColumn;
		output: SQLiteColumn;
	}) =>
		sql<number>`(
			coalesce(${tokens.noCache}, 0) * ${modelCost.inputNoCache}
			+ coalesce(${tokens.cacheRead}, 0) * ${modelCost.inputCacheRead}
			+ coalesce(${tokens.cacheWrite}, 0) * ${modelCost.inputCacheWrite}
			+ coalesce(${tokens.output}, 0) * ${modelCost.output}
		) / 1000000.0`.as('cost_usd');

	// Feedback is per message, but v_messages is at the part grain. Attach it only to a
	// message's first part so the vote/explanation is not repeated across every part.
	const siblingPart = alias(messagePart, 'sibling_part');
	const firstPartOfMessage = eq(
		messagePart.order,
		sql`(${qb
			.select({ minOrder: sql`min(${siblingPart.order})` })
			.from(siblingPart)
			.where(eq(siblingPart.messageId, messagePart.messageId))})`,
	);

	// A chat's source is defined by its first user message, not by each message: assistant
	// messages carry no source, so filtering per message would leak answers from admin chats.
	const chatSource = sql`(
		select source_message.source
		from ${chatMessage} as source_message
		where source_message.chat_id = ${chat.id}
			and source_message.role = 'user'
			and source_message.superseded_at is null
		order by source_message.created_at asc
		limit 1
	)`;

	const messages = {
		chat_id: chatMessage.chatId,
		message_id: sql<string>`${chatMessage.id}`.as('message_id'),
		user_id: chat.userId,
		user_name: sql<string>`${user.name}`.as('user_name'),
		title: chat.title,
		role: chatMessage.role,
		type: messagePart.type,
		text: messagePart.text,
		stop_reason: chatMessage.stopReason,
		error_message: chatMessage.errorMessage,
		llm_provider: chatMessage.llmProvider,
		llm_model_id: chatMessage.llmModelId,
		input_total_tokens: chatMessage.inputTotalTokens,
		input_no_cache_tokens: chatMessage.inputNoCacheTokens,
		input_cache_read_tokens: chatMessage.inputCacheReadTokens,
		input_cache_write_tokens: chatMessage.inputCacheWriteTokens,
		output_total_tokens: chatMessage.outputTotalTokens,
		output_text_tokens: chatMessage.outputTextTokens,
		output_reasoning_tokens: chatMessage.outputReasoningTokens,
		total_tokens: chatMessage.totalTokens,
		cost_usd: costUsd({
			noCache: chatMessage.inputNoCacheTokens,
			cacheRead: chatMessage.inputCacheReadTokens,
			cacheWrite: chatMessage.inputCacheWriteTokens,
			output: chatMessage.outputTotalTokens,
		}),
		superseded_at: timestamp(chatMessage.supersededAt, 'superseded_at'),
		message_source: sql<string>`${chatMessage.source}`.as('message_source'),
		chat_source: chatSource.as('chat_source'),
		tool_name: messagePart.toolName,
		tool_call_id: messagePart.toolCallId,
		tool_state: messagePart.toolState,
		tool_error_text: messagePart.toolErrorText,
		tool_input: messagePart.toolInput,
		tool_output: messagePart.toolOutput,
		vote: messageFeedback.vote,
		explanation: messageFeedback.explanation,
		created_at: timestamp(messagePart.createdAt, 'created_at'),
	};

	const memoriesSelection = {
		id: memories.id,
		user_id: memories.userId,
		content: memories.content,
		category: memories.category,
		chat_id: memories.chatId,
		superseded_by: memories.supersededBy,
		created_at: timestamp(memories.createdAt, 'created_at'),
	};

	const llmInferenceSelection = {
		id: llmInference.id,
		type: llmInference.type,
		user_id: llmInference.userId,
		user_name: sql<string>`${user.name}`.as('user_name'),
		chat_id: llmInference.chatId,
		story_id: llmInference.storyId,
		llm_provider: llmInference.llmProvider,
		llm_model_id: llmInference.llmModelId,
		input_total_tokens: llmInference.inputTotalTokens,
		input_no_cache_tokens: llmInference.inputNoCacheTokens,
		input_cache_read_tokens: llmInference.inputCacheReadTokens,
		input_cache_write_tokens: llmInference.inputCacheWriteTokens,
		output_total_tokens: llmInference.outputTotalTokens,
		total_tokens: llmInference.totalTokens,
		cost_usd: costUsd({
			noCache: llmInference.inputNoCacheTokens,
			cacheRead: llmInference.inputCacheReadTokens,
			cacheWrite: llmInference.inputCacheWriteTokens,
			output: llmInference.outputTotalTokens,
		}),
		created_at: timestamp(llmInference.createdAt, 'created_at'),
	};

	const mcpCallLogSelection = {
		id: mcpCallLog.id,
		tool_name: mcpCallLog.toolName,
		duration_ms: mcpCallLog.durationMs,
		success: mcpCallLog.success,
		called_at: timestamp(mcpCallLog.calledAt, 'called_at'),
	};

	const projectSelection = { id: project.id, name: project.name };

	const analyticsEventSelection = {
		id: analyticsEvent.id,
		type: analyticsEvent.type,
		asset_type: analyticsEvent.assetType,
		actor_user_id: analyticsEvent.actorUserId,
		actor_user_name: sql<string>`${user.name}`.as('actor_user_name'),
		chat_id: analyticsEvent.chatId,
		story_id: analyticsEvent.storyId,
		shared_chat_id: analyticsEvent.sharedChatId,
		shared_story_id: analyticsEvent.sharedStoryId,
		metadata: analyticsEvent.metadata,
		created_at: timestamp(analyticsEvent.createdAt, 'created_at'),
	};

	const storyOwner = alias(schema.user, 'story_owner');
	const storyOwnerId = sql<string>`coalesce(${chat.userId}, ${story.userId})`;
	const storyFeedbackSelection = {
		story_id: storyFeedback.storyId,
		story_title: sql<string>`${story.title}`.as('story_title'),
		story_owner_id: storyOwnerId.as('story_owner_id'),
		story_owner_name: sql<string>`${storyOwner.name}`.as('story_owner_name'),
		user_id: storyFeedback.userId,
		user_name: sql<string>`${user.name}`.as('user_name'),
		vote: storyFeedback.vote,
		explanation: storyFeedback.explanation,
		created_at: timestamp(storyFeedback.createdAt, 'created_at'),
		updated_at: timestamp(storyFeedback.updatedAt, 'updated_at'),
	};

	const storySelection = {
		id: story.id,
		title: story.title,
		owner_id: storyOwnerId.as('owner_id'),
		owner_name: sql<string>`${storyOwner.name}`.as('owner_name'),
		chat_id: story.chatId,
		format: story.format,
		is_live: story.isLive,
		is_live_text_dynamic: story.isLiveTextDynamic,
		cache_schedule: story.cacheSchedule,
		cache_schedule_description: story.cacheScheduleDescription,
		archived_at: timestamp(story.archivedAt, 'archived_at'),
		created_at: timestamp(story.createdAt, 'created_at'),
	};

	const automationRunSelection = {
		id: automationRun.id,
		automation_id: automationRun.automationId,
		automation_title: sql<string>`${automation.title}`.as('automation_title'),
		owner_id: sql<string>`${automation.userId}`.as('owner_id'),
		owner_name: sql<string>`${user.name}`.as('owner_name'),
		schedule_description: automation.scheduleDescription,
		trigger: automationRun.trigger,
		status: automationRun.status,
		chat_id: automationRun.chatId,
		error_message: automationRun.errorMessage,
		started_at: timestamp(automationRun.startedAt, 'started_at'),
		completed_at: timestamp(automationRun.completedAt, 'completed_at'),
	};

	const triggeredBy = alias(schema.user, 'triggered_by');
	const testRunSelection = {
		id: testRun.id,
		trigger: testRun.trigger,
		status: testRun.status,
		triggered_by_user_id: testRun.triggeredByUserId,
		triggered_by_user_name: sql<string>`${triggeredBy.name}`.as('triggered_by_user_name'),
		context_ref: testRun.contextRef,
		context_commit: testRun.contextCommit,
		models: testRun.models,
		attempts: testRun.attempts,
		selection: testRun.selection,
		total_attempts: testRun.totalAttempts,
		completed_attempts: testRun.completedAttempts,
		passed_attempts: testRun.passedAttempts,
		total_tokens: testRun.totalTokens,
		total_cost: testRun.totalCost,
		error_message: testRun.errorMessage,
		created_at: timestamp(testRun.createdAt, 'created_at'),
		started_at: timestamp(testRun.startedAt, 'started_at'),
		completed_at: timestamp(testRun.completedAt, 'completed_at'),
	};

	const testResultSelection = {
		id: testRunResult.id,
		run_id: testRunResult.runId,
		run_trigger: sql<string>`${testRun.trigger}`.as('run_trigger'),
		run_status: sql<string>`${testRun.status}`.as('run_status'),
		test_path: testRunResult.testPath,
		test_name: testRunResult.testName,
		test_hash: testRunResult.testHash,
		tags: testRunResult.tags,
		llm_provider: testRunResult.llmProvider,
		llm_model_id: testRunResult.llmModelId,
		reasoning_effort: testRunResult.reasoningEffort,
		context_variant: testRunResult.contextVariant,
		attempt: testRunResult.attempt,
		passed: testRunResult.passed,
		message: testRunResult.message,
		error_message: testRunResult.errorMessage,
		chat_id: testRunResult.chatId,
		total_tokens: testRunResult.totalTokens,
		total_cost: testRunResult.totalCost,
		duration_ms: testRunResult.durationMs,
		tool_call_count: testRunResult.toolCallCount,
		created_at: timestamp(testRunResult.createdAt, 'created_at'),
	};

	return [
		toView(
			'v_messages',
			messages,
			qb
				.select(messages)
				.from(messagePart)
				.leftJoin(
					messageFeedback,
					and(eq(messagePart.messageId, messageFeedback.messageId), firstPartOfMessage),
				)
				.leftJoin(chatMessage, eq(messagePart.messageId, chatMessage.id))
				.leftJoin(
					modelCost,
					modelCostOf(chatMessage.llmProvider, chatMessage.llmModelId, chatMessage.llmConfigId),
				)
				.leftJoin(chat, eq(chat.id, chatMessage.chatId))
				.leftJoin(user, eq(user.id, chat.userId))
				.where(
					and(
						inArray(chat.projectId, scopedProjectIds()),
						sql`(${chatSource} is null or ${chatSource} <> 'admin')`,
					),
				)
				.orderBy(chatMessage.chatId, asc(messagePart.createdAt)),
		),
		toView(
			'v_memories',
			memoriesSelection,
			qb
				.select(memoriesSelection)
				.from(memories)
				.where(
					inArray(
						memories.chatId,
						qb.select({ id: chat.id }).from(chat).where(inArray(chat.projectId, scopedProjectIds())),
					),
				),
		),
		toView(
			'v_llm_inference',
			llmInferenceSelection,
			qb
				.select(llmInferenceSelection)
				.from(llmInference)
				.leftJoin(user, eq(user.id, llmInference.userId))
				.leftJoin(
					modelCost,
					modelCostOf(llmInference.llmProvider, llmInference.llmModelId, llmInference.llmConfigId),
				)
				.where(inArray(llmInference.projectId, scopedProjectIds())),
		),
		toView(
			'v_mcp_call_log',
			mcpCallLogSelection,
			qb.select(mcpCallLogSelection).from(mcpCallLog).where(inArray(mcpCallLog.projectId, scopedProjectIds())),
		),
		toView(
			'v_project',
			projectSelection,
			qb.select(projectSelection).from(project).where(inArray(project.id, scopedProjectIds())),
		),
		toView(
			'v_analytics_event',
			analyticsEventSelection,
			qb
				.select(analyticsEventSelection)
				.from(analyticsEvent)
				.leftJoin(user, eq(user.id, analyticsEvent.actorUserId))
				.where(inArray(analyticsEvent.projectId, scopedProjectIds())),
		),
		toView(
			'v_story_feedback',
			storyFeedbackSelection,
			qb
				.select(storyFeedbackSelection)
				.from(storyFeedback)
				.innerJoin(story, eq(story.id, storyFeedback.storyId))
				.leftJoin(chat, eq(chat.id, story.chatId))
				.leftJoin(user, eq(user.id, storyFeedback.userId))
				.leftJoin(storyOwner, eq(storyOwner.id, storyOwnerId))
				.where(or(inArray(story.projectId, scopedProjectIds()), inArray(chat.projectId, scopedProjectIds()))),
		),
		toView(
			'v_stories',
			storySelection,
			qb
				.select(storySelection)
				.from(story)
				.leftJoin(chat, eq(chat.id, story.chatId))
				.leftJoin(storyOwner, eq(storyOwner.id, storyOwnerId))
				.where(or(inArray(story.projectId, scopedProjectIds()), inArray(chat.projectId, scopedProjectIds()))),
		),
		toView(
			'v_automation_runs',
			automationRunSelection,
			qb
				.select(automationRunSelection)
				.from(automationRun)
				.innerJoin(automation, eq(automation.id, automationRun.automationId))
				.leftJoin(user, eq(user.id, automation.userId))
				.where(inArray(automation.projectId, scopedProjectIds())),
		),
		toView(
			'v_test_runs',
			testRunSelection,
			qb
				.select(testRunSelection)
				.from(testRun)
				.leftJoin(triggeredBy, eq(triggeredBy.id, testRun.triggeredByUserId))
				.where(inArray(testRun.projectId, scopedProjectIds())),
		),
		toView(
			'v_test_results',
			testResultSelection,
			qb
				.select(testResultSelection)
				.from(testRunResult)
				.innerJoin(testRun, eq(testRun.id, testRunResult.runId))
				.where(inArray(testRun.projectId, scopedProjectIds())),
		),
	];
}

function toView(name: string, selection: Record<string, unknown>, query: { toSQL(): { sql: string } }): ScopedView {
	return { name, body: query.toSQL().sql, columns: Object.keys(selection) };
}

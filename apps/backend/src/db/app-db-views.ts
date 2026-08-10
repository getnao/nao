import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { alias as pgAlias, pgTable, QueryBuilder as PgQueryBuilder, text as pgText } from 'drizzle-orm/pg-core';
import {
	alias as sqliteAlias,
	QueryBuilder as SqliteQueryBuilder,
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
type AliasFn = typeof sqliteAlias;
type TimestampFn = (column: SQLiteColumn, name: string) => SQL.Aliased<string>;

/** Postgres already stores native timestamps. */
const postgresTimestamp: TimestampFn = (column, name) => sql<string>`${column}`.as(name);

/** SQLite stores epoch milliseconds, which no date function accepts as-is. */
const sqliteTimestamp: TimestampFn = (column, name) => sql<string>`datetime(${column} / 1000, 'unixepoch')`.as(name);

const sqliteScope = sqliteTable('_scope', { projectId: sqliteText('project_id').notNull() });
const pgScope = pgTable('_scope', { projectId: pgText('project_id').notNull() });

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
			new PgQueryBuilder() as unknown as SqliteQueryBuilder,
			pgAlias as unknown as AliasFn,
			postgresTimestamp,
		);
	}
	return buildScopedViews(sqliteSchema, sqliteScope, new SqliteQueryBuilder(), sqliteAlias, sqliteTimestamp);
}

/** View name -> exposed columns. Dialect-independent; safe to use in prompts and allowlists. */
export const APP_DB_VIEW_COLUMNS: Record<string, string[]> = Object.fromEntries(
	getScopedViews().map((view) => [view.name, view.columns]),
);

function buildScopedViews(
	schema: ViewSchema,
	scope: ScopeTable,
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
	} = schema;
	const scopedProjectIds = () => qb.select({ projectId: scope.projectId }).from(scope);

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
		message_id: chatMessage.id,
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
		total_tokens: llmInference.totalTokens,
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
	];
}

function toView(name: string, selection: Record<string, unknown>, query: { toSQL(): { sql: string } }): ScopedView {
	return { name, body: query.toSQL().sql, columns: Object.keys(selection) };
}

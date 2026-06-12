import { asc, eq, inArray } from 'drizzle-orm';
import { pgTable, QueryBuilder as PgQueryBuilder, text as pgText } from 'drizzle-orm/pg-core';
import { QueryBuilder as SqliteQueryBuilder, sqliteTable, text as sqliteText } from 'drizzle-orm/sqlite-core';

import dbConfig, { Dialect } from './dbConfig';
import * as pgSchema from './pg-schema';
import * as sqliteSchema from './sqlite-schema';

export interface ScopedView {
	name: string;
	/** The SELECT body the view is created from (no trailing semicolon). */
	body: string;
	/** Columns the view exposes, in select order. Derived from the query, never hand-written. */
	columns: string[];
}

type ViewSchema = typeof sqliteSchema;
type ScopeTable = typeof sqliteScope;

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
		);
	}
	return buildScopedViews(sqliteSchema, sqliteScope, new SqliteQueryBuilder());
}

/** View name -> exposed columns. Dialect-independent; safe to use in prompts and allowlists. */
export const APP_DB_VIEW_COLUMNS: Record<string, string[]> = Object.fromEntries(
	getScopedViews().map((view) => [view.name, view.columns]),
);

function buildScopedViews(schema: ViewSchema, scope: ScopeTable, qb: SqliteQueryBuilder): ScopedView[] {
	const { chat, chatMessage, messagePart, messageFeedback, memories, llmInference, mcpCallLog, project } = schema;
	const scopedProjectIds = () => qb.select({ projectId: scope.projectId }).from(scope);

	const messages = {
		chat_id: chatMessage.chatId,
		title: chat.title,
		role: chatMessage.role,
		type: messagePart.type,
		text: messagePart.text,
		stop_reason: chatMessage.stopReason,
		error_message: chatMessage.errorMessage,
		llm_provider: chatMessage.llmProvider,
		llm_model_id: chatMessage.llmModelId,
		superseded_at: chatMessage.supersededAt,
		source: chatMessage.source,
		tool_name: messagePart.toolName,
		tool_state: messagePart.toolState,
		tool_error_text: messagePart.toolErrorText,
		tool_input: messagePart.toolInput,
		tool_output: messagePart.toolOutput,
		vote: messageFeedback.vote,
		explanation: messageFeedback.explanation,
		created_at: messagePart.createdAt,
	};

	const memoriesSelection = {
		id: memories.id,
		user_id: memories.userId,
		content: memories.content,
		category: memories.category,
		chat_id: memories.chatId,
		superseded_by: memories.supersededBy,
		created_at: memories.createdAt,
	};

	const llmInferenceSelection = {
		id: llmInference.id,
		type: llmInference.type,
		total_tokens: llmInference.totalTokens,
		created_at: llmInference.createdAt,
	};

	const mcpCallLogSelection = {
		id: mcpCallLog.id,
		tool_name: mcpCallLog.toolName,
		duration_ms: mcpCallLog.durationMs,
		success: mcpCallLog.success,
		called_at: mcpCallLog.calledAt,
	};

	const projectSelection = { id: project.id, name: project.name };

	return [
		toView(
			'v_messages',
			messages,
			qb
				.select(messages)
				.from(messagePart)
				.leftJoin(messageFeedback, eq(messagePart.messageId, messageFeedback.messageId))
				.leftJoin(chatMessage, eq(messagePart.messageId, chatMessage.id))
				.leftJoin(chat, eq(chat.id, chatMessage.chatId))
				.where(inArray(chat.projectId, scopedProjectIds()))
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
	];
}

function toView(name: string, selection: Record<string, unknown>, query: { toSQL(): { sql: string } }): ScopedView {
	return { name, body: query.toSQL().sql, columns: Object.keys(selection) };
}

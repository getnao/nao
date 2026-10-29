/* @license Enterprise */

import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, notInArray, type SQL, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type {
	InstanceLogFilter,
	InstanceLogsInput,
	InstanceLogSortKey,
	InstanceLogTextColumn,
	LogPaginationInput,
	MessagePaginationInput,
	PaginatedResult,
} from '../types/backoffice';
import { redactContext, REDACTED_CONTEXT_VALUE, SENSITIVE_CONTEXT_KEYS } from '../utils/logger';

type InstanceLogTextFilter = Extract<InstanceLogFilter, { column: InstanceLogTextColumn }>;

export async function listProjectMessages(
	projectId: string,
	input: MessagePaginationInput,
): Promise<PaginatedResult<unknown>> {
	const filters = [
		eq(s.chat.projectId, projectId),
		input.errorsOnly ? isNotNull(s.chatMessage.errorMessage) : undefined,
		input.role ? eq(s.chatMessage.role, input.role) : undefined,
	].filter(isDefined);
	const where = and(...filters);
	const [items, totalRows] = await Promise.all([
		db
			.select({
				id: s.chatMessage.id,
				chatId: s.chat.id,
				chatTitle: s.chat.title,
				userId: s.user.id,
				userEmail: s.user.email,
				role: s.chatMessage.role,
				source: s.chatMessage.source,
				stopReason: s.chatMessage.stopReason,
				errorMessage: s.chatMessage.errorMessage,
				llmProvider: s.chatMessage.llmProvider,
				llmModelId: s.chatMessage.llmModelId,
				inputTotalTokens: s.chatMessage.inputTotalTokens,
				outputTotalTokens: s.chatMessage.outputTotalTokens,
				totalTokens: s.chatMessage.totalTokens,
				supersededAt: s.chatMessage.supersededAt,
				createdAt: s.chatMessage.createdAt,
			})
			.from(s.chatMessage)
			.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
			.innerJoin(s.user, eq(s.user.id, s.chat.userId))
			.where(where)
			.orderBy(desc(s.chatMessage.createdAt), desc(s.chatMessage.id))
			.limit(input.limit)
			.offset(input.offset)
			.execute(),
		db
			.select({ count: count() })
			.from(s.chatMessage)
			.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
			.where(where)
			.execute(),
	]);
	return { items, total: Number(totalRows[0]?.count ?? 0) };
}

export async function listProjectLogs(projectId: string, input: LogPaginationInput): Promise<PaginatedResult<unknown>> {
	const where = input.level
		? and(eq(s.log.projectId, projectId), eq(s.log.level, input.level))
		: eq(s.log.projectId, projectId);
	const [items, totalRows] = await Promise.all([
		db
			.select({
				id: s.log.id,
				level: s.log.level,
				source: s.log.source,
				message: s.log.message,
				createdAt: s.log.createdAt,
			})
			.from(s.log)
			.where(where)
			.orderBy(desc(s.log.createdAt), desc(s.log.id))
			.limit(input.limit)
			.offset(input.offset)
			.execute(),
		db.select({ count: count() }).from(s.log).where(where).execute(),
	]);
	return { items, total: Number(totalRows[0]?.count ?? 0) };
}

/** Logs of the whole instance, including the ones attached to no project such as HTTP requests. */
export async function listInstanceLogs(input: InstanceLogsInput): Promise<PaginatedResult<unknown>> {
	const where = and(...input.filters.map(toInstanceLogCondition));
	const direction = input.direction === 'asc' ? asc : desc;
	const [rows, totalRows] = await Promise.all([
		db
			.select({
				id: s.log.id,
				level: s.log.level,
				source: s.log.source,
				message: s.log.message,
				context: s.log.context,
				projectId: s.log.projectId,
				projectName: s.project.name,
				orgId: s.organization.id,
				orgName: s.organization.name,
				createdAt: s.log.createdAt,
			})
			.from(s.log)
			.leftJoin(s.project, eq(s.project.id, s.log.projectId))
			.leftJoin(s.organization, eq(s.organization.id, s.project.orgId))
			.where(where)
			.orderBy(direction(instanceLogSortExpression(input.sort)), desc(s.log.createdAt), desc(s.log.id))
			.limit(input.limit)
			.offset(input.offset)
			.execute(),
		db
			.select({ count: count() })
			.from(s.log)
			.leftJoin(s.project, eq(s.project.id, s.log.projectId))
			.leftJoin(s.organization, eq(s.organization.id, s.project.orgId))
			.where(where)
			.execute(),
	]);
	const items = rows.map((row) => ({ ...row, context: row.context ? redactContext(row.context) : null }));
	return { items, total: Number(totalRows[0]?.count ?? 0) };
}

function toInstanceLogCondition(filter: InstanceLogFilter): SQL | undefined {
	switch (filter.column) {
		case 'createdAt':
			return filter.operator === 'after'
				? gte(s.log.createdAt, filter.value)
				: lte(s.log.createdAt, filter.value);
		case 'level':
			return filter.operator === 'in'
				? inArray(s.log.level, filter.values)
				: notInArray(s.log.level, filter.values);
		case 'source':
			return filter.operator === 'in'
				? inArray(s.log.source, filter.values)
				: notInArray(s.log.source, filter.values);
		default:
			return toTextCondition(filter);
	}
}

/** Text filters are case-insensitive and treat a missing value (e.g. a log without project) as an empty string. */
function toTextCondition(filter: InstanceLogTextFilter): SQL {
	const text = sql`lower(coalesce(${instanceLogTextExpression(filter.column)}, ''))`;
	const pattern = escapeLikePattern(filter.value);
	switch (filter.operator) {
		case 'contains':
			return sql`${text} like lower(${`%${pattern}%`}) escape '\\'`;
		case 'notContains':
			return sql`${text} not like lower(${`%${pattern}%`}) escape '\\'`;
		case 'startsWith':
			return sql`${text} like lower(${`${pattern}%`}) escape '\\'`;
		case 'equals':
			return sql`${text} = lower(${filter.value})`;
		case 'notEquals':
			return sql`${text} <> lower(${filter.value})`;
		case 'isEmpty':
			return sql`${text} = ''`;
		case 'isNotEmpty':
			return sql`${text} <> ''`;
	}
}

function instanceLogTextExpression(column: InstanceLogTextColumn): SQL {
	switch (column) {
		case 'message':
			return sql`${s.log.message}`;
		case 'context':
			return redactedContextText();
		case 'project':
			return sql`${s.project.name}`;
		case 'organization':
			return sql`${s.organization.name}`;
	}
}

/** The context as `redactContext` returns it, so text filters can't match the values it hides. */
function redactedContextText(): SQL {
	return dbConfig.dialect === Dialect.Postgres ? postgresRedactedContextText() : sqliteRedactedContextText();
}

function postgresRedactedContextText(): SQL {
	const context = s.log.context;
	const value = sql`case when ${isSensitiveContextKey()} then to_jsonb(cast(${REDACTED_CONTEXT_VALUE} as text)) else entry.value end`;
	const redacted = sql`(select jsonb_object_agg(entry.key, ${value}) from jsonb_each(${context}) as entry)`;
	return sql`case when jsonb_typeof(${context}) = 'object' then cast(coalesce(${redacted}, '{}'::jsonb) as text) else cast(${context} as text) end`;
}

function sqliteRedactedContextText(): SQL {
	const context = s.log.context;
	const value = sql`case when ${isSensitiveContextKey()} then ${REDACTED_CONTEXT_VALUE} else ${context} -> entry.fullkey end`;
	const redacted = sql`(select json_group_object(entry.key, ${value}) from json_each(${context}) as entry)`;
	return sql`case when json_type(${context}) = 'object' then ${redacted} else ${context} end`;
}

function isSensitiveContextKey(): SQL {
	return inArray(sql`lower(entry.key)`, SENSITIVE_CONTEXT_KEYS);
}

function instanceLogSortExpression(key: InstanceLogSortKey): SQL {
	switch (key) {
		case 'createdAt':
			return sql`${s.log.createdAt}`;
		case 'level':
			return sql`case ${s.log.level} when 'error' then 3 when 'warn' then 2 when 'info' then 1 else 0 end`;
		case 'source':
			return sql`${s.log.source}`;
		case 'message':
			return sql`${s.log.message}`;
		case 'project':
			return sql`${s.project.name}`;
		case 'organization':
			return sql`${s.organization.name}`;
	}
}

function escapeLikePattern(value: string): string {
	return value.replace(/[%_\\]/g, '\\$&');
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}

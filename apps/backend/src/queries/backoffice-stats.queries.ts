/* @license Enterprise */

import { and, count, countDistinct, desc, eq, gte, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { ResourceStats } from '../types/backoffice';
import * as usageQueries from './backoffice-usage.queries';

const DAY_MS = 24 * 60 * 60 * 1_000;

export async function getBackofficeStats() {
	const now = new Date();
	const last7d = new Date(now.getTime() - 7 * DAY_MS);
	const last30d = new Date(now.getTime() - 30 * DAY_MS);

	const [totals, sevenDay, thirtyDay, messagesPerDay, topProjectsByMessages30d, modelsUsage30d] = await Promise.all([
		getTotals(),
		getWindowStats(last7d, false),
		getWindowStats(last30d, true),
		getMessagesPerDay(last30d, now),
		getTopProjects(last30d),
		usageQueries.getModelsUsage(last30d),
	]);

	return {
		totals,
		last7d: sevenDay,
		last30d: thirtyDay,
		messagesPerDay,
		topProjectsByMessages30d,
		modelsUsage30d,
	};
}

export async function getOrganizationStats(orgId: string): Promise<ResourceStats> {
	return getResourceStats(eq(s.project.orgId, orgId));
}

export async function getProjectStats(projectId: string) {
	const cutoff = new Date(Date.now() - 30 * DAY_MS);
	const [stats, tokens, lastMessage, messagesPerDay] = await Promise.all([
		getResourceStats(eq(s.project.id, projectId)),
		usageQueries.getProjectTokens(projectId, cutoff),
		getLastProjectMessage(projectId),
		getProjectMessagesPerDay(projectId, cutoff, new Date()),
	]);

	return {
		...stats,
		inputTokens30d: tokens.inputTokens,
		outputTokens30d: tokens.outputTokens,
		lastMessageAt: lastMessage,
		messagesPerDay,
	};
}

async function getTotals() {
	const [organizations, projects, users, chats, messages, llmInferences] = await Promise.all([
		countRows(s.organization),
		countRows(s.project),
		countRows(s.user),
		countRows(s.chat),
		countRows(s.chatMessage),
		countRows(s.llmInference),
	]);
	return { organizations, projects, users, chats, messages, llmInferences };
}

async function getWindowStats(cutoff: Date, includeTokens: boolean) {
	const [newUsers, activeUsers, newOrganizations, chats, messageStats, inferenceTokens] = await Promise.all([
		countRowsSince(s.user, s.user.createdAt, cutoff),
		getActiveUsers(cutoff),
		countRowsSince(s.organization, s.organization.createdAt, cutoff),
		countRowsSince(s.chat, s.chat.createdAt, cutoff),
		getMessageWindowStats(cutoff),
		includeTokens ? usageQueries.getInferenceTokens(cutoff) : Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
	]);

	const base = {
		newUsers,
		activeUsers,
		newOrganizations,
		chats,
		messages: messageStats.messages,
		errors: messageStats.errors,
	};
	if (!includeTokens) {
		return base;
	}
	return {
		...base,
		inputTokens: messageStats.inputTokens + inferenceTokens.inputTokens,
		outputTokens: messageStats.outputTokens + inferenceTokens.outputTokens,
	};
}

async function getResourceStats(projectFilter: ReturnType<typeof eq>): Promise<ResourceStats> {
	const cutoff = new Date(Date.now() - 30 * DAY_MS);
	const [row] = await db
		.select({
			chats: countDistinct(s.chat.id),
			messages: count(s.chatMessage.id),
			errors: sql<number>`sum(case when ${s.chatMessage.errorMessage} is not null then 1 else 0 end)`,
			messages30d: sql<number>`sum(case when ${gte(s.chatMessage.createdAt, cutoff)} then 1 else 0 end)`,
			errors30d: sql<number>`sum(case when ${gte(s.chatMessage.createdAt, cutoff)} and ${s.chatMessage.errorMessage} is not null then 1 else 0 end)`,
			activeUsers30d: sql<number>`count(distinct case when ${gte(s.chatMessage.createdAt, cutoff)} then ${s.chat.userId} end)`,
		})
		.from(s.project)
		.leftJoin(s.chat, eq(s.chat.projectId, s.project.id))
		.leftJoin(s.chatMessage, eq(s.chatMessage.chatId, s.chat.id))
		.where(projectFilter)
		.execute();

	return {
		chats: Number(row?.chats ?? 0),
		messages: Number(row?.messages ?? 0),
		errors: Number(row?.errors ?? 0),
		messages30d: Number(row?.messages30d ?? 0),
		errors30d: Number(row?.errors30d ?? 0),
		activeUsers30d: Number(row?.activeUsers30d ?? 0),
	};
}

async function getMessagesPerDay(cutoff: Date, now: Date) {
	const date = dateExpression(s.chatMessage.createdAt);
	const rows = await db
		.select({
			date,
			messages: count(),
			errors: sql<number>`sum(case when ${s.chatMessage.errorMessage} is not null then 1 else 0 end)`,
			activeUsers: countDistinct(s.chat.userId),
		})
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(gte(s.chatMessage.createdAt, cutoff))
		.groupBy(date)
		.execute();

	return fillDays(now, rows, (day, row) => ({
		date: day,
		messages: Number(row?.messages ?? 0),
		errors: Number(row?.errors ?? 0),
		activeUsers: Number(row?.activeUsers ?? 0),
	}));
}

async function getProjectMessagesPerDay(projectId: string, cutoff: Date, now: Date) {
	const date = dateExpression(s.chatMessage.createdAt);
	const rows = await db
		.select({
			date,
			messages: count(),
			errors: sql<number>`sum(case when ${s.chatMessage.errorMessage} is not null then 1 else 0 end)`,
		})
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(and(eq(s.chat.projectId, projectId), gte(s.chatMessage.createdAt, cutoff)))
		.groupBy(date)
		.execute();

	return fillDays(now, rows, (day, row) => ({
		date: day,
		messages: Number(row?.messages ?? 0),
		errors: Number(row?.errors ?? 0),
	}));
}

async function getTopProjects(cutoff: Date) {
	const rows = await db
		.select({
			projectId: s.project.id,
			projectName: s.project.name,
			orgId: s.organization.id,
			orgName: s.organization.name,
			messages: count(s.chatMessage.id),
		})
		.from(s.project)
		.leftJoin(s.organization, eq(s.organization.id, s.project.orgId))
		.innerJoin(s.chat, eq(s.chat.projectId, s.project.id))
		.innerJoin(s.chatMessage, and(eq(s.chatMessage.chatId, s.chat.id), gte(s.chatMessage.createdAt, cutoff)))
		.groupBy(s.project.id, s.project.name, s.organization.id, s.organization.name)
		.orderBy(desc(count(s.chatMessage.id)))
		.limit(10)
		.execute();

	return rows.map((row) => ({
		...row,
		orgId: row.orgId ?? '',
		orgName: row.orgName ?? '',
		messages: Number(row.messages),
	}));
}

async function getLastProjectMessage(projectId: string): Promise<Date | null> {
	const [row] = await db
		.select({ createdAt: s.chatMessage.createdAt })
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(eq(s.chat.projectId, projectId))
		.orderBy(desc(s.chatMessage.createdAt))
		.limit(1)
		.execute();
	return row?.createdAt ?? null;
}

async function getActiveUsers(cutoff: Date): Promise<number> {
	const [row] = await db
		.select({ count: countDistinct(s.chat.userId) })
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(gte(s.chatMessage.createdAt, cutoff))
		.execute();
	return Number(row?.count ?? 0);
}

async function getMessageWindowStats(cutoff: Date) {
	const [row] = await db
		.select({
			messages: count(),
			errors: sql<number>`sum(case when ${s.chatMessage.errorMessage} is not null then 1 else 0 end)`,
			inputTokens: sql<number>`coalesce(sum(${s.chatMessage.inputTotalTokens}), 0)`,
			outputTokens: sql<number>`coalesce(sum(${s.chatMessage.outputTotalTokens}), 0)`,
		})
		.from(s.chatMessage)
		.where(gte(s.chatMessage.createdAt, cutoff))
		.execute();
	return toNumericStats(row);
}

async function countRows(
	table:
		| typeof s.organization
		| typeof s.project
		| typeof s.user
		| typeof s.chat
		| typeof s.chatMessage
		| typeof s.llmInference,
) {
	const [row] = await db.select({ count: count() }).from(table).execute();
	return Number(row?.count ?? 0);
}

async function countRowsSince(
	table: typeof s.user | typeof s.organization | typeof s.chat,
	createdAt: typeof s.user.createdAt | typeof s.organization.createdAt | typeof s.chat.createdAt,
	cutoff: Date,
) {
	const [row] = await db.select({ count: count() }).from(table).where(gte(createdAt, cutoff)).execute();
	return Number(row?.count ?? 0);
}

function dateExpression(column: typeof s.chatMessage.createdAt) {
	return dbConfig.dialect === Dialect.Postgres
		? sql<string>`to_char(${column}, 'YYYY-MM-DD')`
		: sql<string>`strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`;
}

function fillDays<T extends { date: string }, R>(
	now: Date,
	rows: T[],
	mapper: (day: string, row: T | undefined) => R,
): R[] {
	const byDate = new Map(rows.map((row) => [row.date, row]));
	return Array.from({ length: 30 }, (_, index) => {
		const day = new Date(now);
		day.setUTCHours(0, 0, 0, 0);
		day.setUTCDate(day.getUTCDate() - (29 - index));
		const key = day.toISOString().slice(0, 10);
		return mapper(key, byDate.get(key));
	});
}

function toNumericStats(row: Record<string, unknown> | undefined) {
	return {
		messages: Number(row?.messages ?? 0),
		errors: Number(row?.errors ?? 0),
		inputTokens: Number(row?.inputTokens ?? 0),
		outputTokens: Number(row?.outputTokens ?? 0),
	};
}

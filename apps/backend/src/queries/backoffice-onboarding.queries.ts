/* @license Enterprise */

import { SYSTEM_EXAMPLE_PROJECT_ID } from '@nao/shared';
import { and, count, desc, eq, inArray, isNotNull, ne, notExists, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

const ONBOARDING_TOOL_NAMES = [
	'onboarding_progress',
	'request_warehouse_credentials',
	'onboarding_command',
	'generate_onboarding_rules',
	'restart_onboarding',
];
const MESSAGE_PREFIX_LENGTH = 1_000;

export async function listUserSignups(userId?: string) {
	return db
		.select({ userId: s.user.id, createdAt: s.user.createdAt })
		.from(s.user)
		.where(userId ? eq(s.user.id, userId) : undefined)
		.execute();
}

export async function listJaffleShopActivity(userId?: string) {
	const rows = await db
		.select({
			userId: s.chat.userId,
			firstMessageAt: sql<Date>`min(${s.chatMessage.createdAt})`.mapWith(s.chatMessage.createdAt),
			messageCount: count(),
		})
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(
			and(
				eq(s.chat.projectId, SYSTEM_EXAMPLE_PROJECT_ID),
				eq(s.chatMessage.role, 'user'),
				sql`coalesce(${s.chatMessage.source}, '') <> 'onboarding'`,
				userId ? eq(s.chat.userId, userId) : undefined,
			),
		)
		.groupBy(s.chat.userId)
		.execute();
	return rows.map((row) => ({ ...row, messageCount: Number(row.messageCount) }));
}

/** Journeys only show the start of each message, so the full text is never loaded. */
export async function listOnboardingMessages(userId?: string) {
	return db
		.select({
			userId: s.chat.userId,
			createdAt: s.chatMessage.createdAt,
			text: sql<string>`substr(${s.messagePart.text}, 1, ${sql.raw(String(MESSAGE_PREFIX_LENGTH))})`,
		})
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.chatMessage.id, s.messagePart.messageId))
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(
			and(
				eq(s.chatMessage.source, 'onboarding'),
				eq(s.chatMessage.role, 'user'),
				eq(s.messagePart.type, 'text'),
				isNotNull(s.messagePart.text),
				userId ? eq(s.chat.userId, userId) : undefined,
			),
		)
		.execute();
}

export async function listOnboardingToolCalls(userId?: string) {
	return db
		.select({
			userId: s.chat.userId,
			createdAt: s.chatMessage.createdAt,
			toolName: s.messagePart.toolName,
			toolInput: s.messagePart.toolInput,
		})
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.chatMessage.id, s.messagePart.messageId))
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(
			and(
				eq(s.chatMessage.source, 'onboarding'),
				inArray(s.messagePart.toolName, ONBOARDING_TOOL_NAMES),
				userId ? eq(s.chat.userId, userId) : undefined,
			),
		)
		.execute();
}

export async function listOnboardingAgentErrors(userId?: string) {
	return db
		.select({
			userId: s.chat.userId,
			createdAt: s.chatMessage.createdAt,
			errorMessage: s.chatMessage.errorMessage,
		})
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(
			and(
				eq(s.chatMessage.source, 'onboarding'),
				eq(s.chatMessage.role, 'assistant'),
				isNotNull(s.chatMessage.errorMessage),
				userId ? eq(s.chat.userId, userId) : undefined,
			),
		)
		.execute();
}

export async function listConnectionChecks(userId?: string) {
	return db
		.select({
			userId: s.warehouseConnectionCheck.userId,
			createdAt: s.warehouseConnectionCheck.createdAt,
			provider: s.warehouseConnectionCheck.provider,
			outcome: s.warehouseConnectionCheck.outcome,
			error: s.warehouseConnectionCheck.error,
		})
		.from(s.warehouseConnectionCheck)
		.where(userId ? eq(s.warehouseConnectionCheck.userId, userId) : undefined)
		.execute();
}

export async function listProvisioningJobs(userId?: string) {
	return db
		.select({
			userId: s.warehouseProvisioningJob.userId,
			provider: s.warehouseProvisioningJob.provider,
			status: s.warehouseProvisioningJob.status,
			failedStatus: s.warehouseProvisioningJob.failedStatus,
			error: s.warehouseProvisioningJob.error,
			errorDetail: sql<
				string | null
			>`substr(${s.warehouseProvisioningJob.errorDetail}, 1, ${sql.raw(String(MESSAGE_PREFIX_LENGTH))})`,
			createdAt: s.warehouseProvisioningJob.createdAt,
			updatedAt: s.warehouseProvisioningJob.updatedAt,
			finishedAt: s.warehouseProvisioningJob.finishedAt,
		})
		.from(s.warehouseProvisioningJob)
		.where(userId ? eq(s.warehouseProvisioningJob.userId, userId) : undefined)
		.execute();
}

export async function listProvisioningSetups(userId: string) {
	return db
		.select({
			id: s.warehouseProvisioningJob.id,
			chatId: s.warehouseProvisioningJob.onboardingChatId,
			projectId: s.warehouseProvisioningJob.projectId,
			projectName: s.warehouseProvisioningJob.projectName,
			provider: s.warehouseProvisioningJob.provider,
			status: s.warehouseProvisioningJob.status,
			failedStatus: s.warehouseProvisioningJob.failedStatus,
			steps: s.warehouseProvisioningJob.steps,
			error: s.warehouseProvisioningJob.error,
			errorDetail: s.warehouseProvisioningJob.errorDetail,
			logs: s.warehouseProvisioningJob.logs,
			workerId: s.warehouseProvisioningJob.lockedBy,
			heartbeatAt: s.warehouseProvisioningJob.lockedAt,
			createdAt: s.warehouseProvisioningJob.createdAt,
			updatedAt: s.warehouseProvisioningJob.updatedAt,
			finishedAt: s.warehouseProvisioningJob.finishedAt,
		})
		.from(s.warehouseProvisioningJob)
		.where(eq(s.warehouseProvisioningJob.userId, userId))
		.orderBy(desc(s.warehouseProvisioningJob.createdAt))
		.execute();
}

export async function listRecentSetupFailures(limit: number) {
	const job = s.warehouseProvisioningJob;
	const failedAt = sql<Date>`coalesce(${job.finishedAt}, ${job.updatedAt})`.mapWith(job.updatedAt);
	return db
		.select({
			id: job.id,
			userId: job.userId,
			userEmail: s.user.email,
			projectName: job.projectName,
			provider: job.provider,
			failedStatus: job.failedStatus,
			error: job.error,
			errorDetail: sql<string | null>`substr(${job.errorDetail}, 1, ${sql.raw(String(MESSAGE_PREFIX_LENGTH))})`,
			failedAt,
		})
		.from(job)
		.innerJoin(s.user, eq(s.user.id, job.userId))
		.where(eq(job.status, 'failed'))
		.orderBy(desc(failedAt))
		.limit(limit)
		.execute();
}

/** Users reach projects through project or organization membership; projects still being set up don't count. */
export async function listProjectAccess(userId?: string) {
	const [explicitAccess, inheritedAccess] = await Promise.all([
		listExplicitProjectAccess(userId),
		listInheritedProjectAccess(userId),
	]);
	const earliestAccess = new Map<string, ProjectAccess>();
	for (const access of [...explicitAccess, ...inheritedAccess]) {
		const key = `${access.userId}:${access.projectId}`;
		const existing = earliestAccess.get(key);
		if (!existing || access.createdAt < existing.createdAt) {
			earliestAccess.set(key, access);
		}
	}
	return [...earliestAccess.values()];
}

interface ProjectAccess {
	userId: string;
	projectId: string;
	projectName: string;
	createdAt: Date;
}

async function listExplicitProjectAccess(userId?: string): Promise<ProjectAccess[]> {
	return db
		.select({
			userId: s.projectMember.userId,
			projectId: s.project.id,
			projectName: s.project.name,
			createdAt: s.projectMember.createdAt,
		})
		.from(s.projectMember)
		.innerJoin(s.project, eq(s.project.id, s.projectMember.projectId))
		.where(and(isUsableProject(), userId ? eq(s.projectMember.userId, userId) : undefined))
		.execute();
}

async function listInheritedProjectAccess(userId?: string): Promise<ProjectAccess[]> {
	const rows = await db
		.select({
			userId: s.orgMember.userId,
			projectId: s.project.id,
			projectName: s.project.name,
			joinedAt: s.orgMember.createdAt,
			projectCreatedAt: s.project.createdAt,
		})
		.from(s.orgMember)
		.innerJoin(s.project, eq(s.project.orgId, s.orgMember.orgId))
		.where(and(isUsableProject(), userId ? eq(s.orgMember.userId, userId) : undefined))
		.execute();
	return rows.map(({ joinedAt, projectCreatedAt, ...access }) => ({
		...access,
		createdAt: joinedAt > projectCreatedAt ? joinedAt : projectCreatedAt,
	}));
}

function isUsableProject() {
	return and(
		ne(s.project.id, SYSTEM_EXAMPLE_PROJECT_ID),
		notExists(
			db
				.select({ id: s.warehouseProvisioningJob.id })
				.from(s.warehouseProvisioningJob)
				.where(
					and(
						eq(s.warehouseProvisioningJob.projectId, s.project.id),
						ne(s.warehouseProvisioningJob.status, 'ready'),
					),
				),
		),
	);
}

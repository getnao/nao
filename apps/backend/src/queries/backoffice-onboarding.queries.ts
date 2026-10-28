/* @license Enterprise */

import { SYSTEM_EXAMPLE_PROJECT_ID } from '@nao/shared';
import { and, count, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

const ONBOARDING_TOOL_NAMES = [
	'onboarding_progress',
	'request_warehouse_credentials',
	'onboarding_command',
	'generate_onboarding_rules',
];

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

export async function listOnboardingMessages(userId?: string) {
	return db
		.select({
			userId: s.chat.userId,
			createdAt: s.chatMessage.createdAt,
			text: s.messagePart.text,
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
			createdAt: s.warehouseProvisioningJob.createdAt,
			updatedAt: s.warehouseProvisioningJob.updatedAt,
			finishedAt: s.warehouseProvisioningJob.finishedAt,
		})
		.from(s.warehouseProvisioningJob)
		.where(userId ? eq(s.warehouseProvisioningJob.userId, userId) : undefined)
		.execute();
}

export async function listProjectMemberships(userId?: string) {
	return db
		.select({
			userId: s.projectMember.userId,
			projectName: s.project.name,
			createdAt: s.projectMember.createdAt,
		})
		.from(s.projectMember)
		.innerJoin(s.project, eq(s.project.id, s.projectMember.projectId))
		.where(
			and(ne(s.project.id, SYSTEM_EXAMPLE_PROJECT_ID), userId ? eq(s.projectMember.userId, userId) : undefined),
		)
		.execute();
}

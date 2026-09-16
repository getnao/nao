/* @license Enterprise */

import { and, asc, count, desc, eq, gt, gte, inArray, or, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import type { SearchPaginationInput } from '../types/backoffice';

const DAY_MS = 24 * 60 * 60 * 1_000;

export async function listUsers(input: SearchPaginationInput) {
	const searchFilter = buildUserSearchFilter(input.search);
	const projectCounts = db
		.select({
			userId: s.projectMember.userId,
			count: count().as('user_project_count'),
		})
		.from(s.projectMember)
		.groupBy(s.projectMember.userId)
		.as('user_project_counts');
	const [users, totalRows] = await Promise.all([
		db
			.select({
				id: s.user.id,
				name: s.user.name,
				email: s.user.email,
				emailVerified: s.user.emailVerified,
				image: s.user.image,
				createdAt: s.user.createdAt,
				updatedAt: s.user.updatedAt,
				githubAccessToken: s.user.githubAccessToken,
				gitlabAccessToken: s.user.gitlabAccessToken,
				projectCount: projectCounts.count,
			})
			.from(s.user)
			.leftJoin(projectCounts, eq(projectCounts.userId, s.user.id))
			.where(searchFilter)
			.orderBy(desc(s.user.createdAt))
			.limit(input.limit)
			.offset(input.offset)
			.execute(),
		db.select({ count: count() }).from(s.user).where(searchFilter).execute(),
	]);

	const userIds = users.map((user) => user.id);
	const [memberships, lastMessages] = userIds.length
		? await Promise.all([getOrganizationMemberships(userIds), getLastMessages(userIds)])
		: [[], []];
	const byUser = new Map<string, (typeof memberships)[number][]>();
	const lastMessageByUser = new Map(lastMessages.map((row) => [row.userId, row.lastMessageAt]));
	for (const membership of memberships) {
		const entries = byUser.get(membership.userId) ?? [];
		entries.push(membership);
		byUser.set(membership.userId, entries);
	}

	return {
		items: users.map((user) => ({
			id: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified,
			image: user.image,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			hasGithubToken: isSet(user.githubAccessToken),
			hasGitlabToken: isSet(user.gitlabAccessToken),
			organizations: (byUser.get(user.id) ?? []).map((membership) => ({
				orgId: membership.orgId,
				orgName: membership.orgName,
				role: membership.role,
			})),
			projectCount: Number(user.projectCount ?? 0),
			lastMessageAt: lastMessageByUser.get(user.id) ?? null,
		})),
		total: Number(totalRows[0]?.count ?? 0),
	};
}

export async function getUserForBackoffice(userId: string) {
	const [user] = await db.select().from(s.user).where(eq(s.user.id, userId)).limit(1).execute();
	return user ?? null;
}

export async function getUserOrganizations(userId: string) {
	const rows = await getOrganizationMemberships([userId], true);
	return rows.map(({ userId: _, ...membership }) => membership);
}

export async function getUserProjects(userId: string) {
	return db
		.select({
			projectId: s.project.id,
			projectName: s.project.name,
			orgId: s.project.orgId,
			orgName: s.organization.name,
			role: s.projectMember.role,
			createdAt: s.projectMember.createdAt,
		})
		.from(s.projectMember)
		.innerJoin(s.project, eq(s.project.id, s.projectMember.projectId))
		.leftJoin(s.organization, eq(s.organization.id, s.project.orgId))
		.where(eq(s.projectMember.userId, userId))
		.orderBy(asc(s.project.name))
		.execute()
		.then((rows) =>
			rows.map((row) => ({
				...row,
				orgId: row.orgId ?? '',
				orgName: row.orgName ?? '',
			})),
		);
}

export async function getUserStats(userId: string) {
	const cutoff = new Date(Date.now() - 30 * DAY_MS);
	const [chats, messages, lastMessage, sessions] = await Promise.all([
		db.select({ count: count() }).from(s.chat).where(eq(s.chat.userId, userId)).execute(),
		db
			.select({
				messages: count(),
				errors: sql<number>`sum(case when ${s.chatMessage.errorMessage} is not null then 1 else 0 end)`,
				messages30d: sql<number>`sum(case when ${gte(s.chatMessage.createdAt, cutoff)} then 1 else 0 end)`,
			})
			.from(s.chatMessage)
			.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
			.where(eq(s.chat.userId, userId))
			.execute(),
		db
			.select({ createdAt: s.chatMessage.createdAt })
			.from(s.chatMessage)
			.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
			.where(eq(s.chat.userId, userId))
			.orderBy(desc(s.chatMessage.createdAt))
			.limit(1)
			.execute(),
		db
			.select({ count: count() })
			.from(s.session)
			.where(and(eq(s.session.userId, userId), gt(s.session.expiresAt, new Date())))
			.execute(),
	]);
	const row = messages[0];
	return {
		stats: {
			chats: Number(chats[0]?.count ?? 0),
			messages: Number(row?.messages ?? 0),
			errors: Number(row?.errors ?? 0),
			messages30d: Number(row?.messages30d ?? 0),
			lastMessageAt: lastMessage[0]?.createdAt ?? null,
		},
		sessions: { active: Number(sessions[0]?.count ?? 0) },
	};
}

export async function updateUserForBackoffice(userId: string, values: { name?: string; email?: string }) {
	const [updated] = await db.update(s.user).set(values).where(eq(s.user.id, userId)).returning().execute();
	return updated ?? null;
}

export async function getUserByEmail(email: string) {
	const [user] = await db.select({ id: s.user.id }).from(s.user).where(eq(s.user.email, email)).limit(1).execute();
	return user ?? null;
}

async function getOrganizationMemberships(userIds: string[], ordered = false) {
	const query = db
		.select({
			userId: s.orgMember.userId,
			orgId: s.organization.id,
			orgName: s.organization.name,
			role: s.orgMember.role,
			createdAt: s.orgMember.createdAt,
		})
		.from(s.orgMember)
		.innerJoin(s.organization, eq(s.organization.id, s.orgMember.orgId))
		.where(inArray(s.orgMember.userId, userIds));
	return ordered ? query.orderBy(asc(s.organization.name)).execute() : query.execute();
}

async function getLastMessages(userIds: string[]) {
	return db
		.select({
			userId: s.chat.userId,
			lastMessageAt: sql<Date | null>`max(${s.chatMessage.createdAt})`.mapWith(s.chatMessage.createdAt),
		})
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(inArray(s.chat.userId, userIds))
		.groupBy(s.chat.userId)
		.execute();
}

function buildUserSearchFilter(search: string | undefined) {
	const normalized = search?.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}
	const pattern = `%${normalized}%`;
	return or(sql`lower(${s.user.name}) like ${pattern}`, sql`lower(${s.user.email}) like ${pattern}`);
}

function isSet(value: unknown): boolean {
	return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

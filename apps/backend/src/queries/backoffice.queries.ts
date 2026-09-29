/* @license Enterprise */

import { and, asc, count, desc, eq, gte, or, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { ProjectPaginationInput, SearchPaginationInput } from '../types/backoffice';

const DAY_MS = 24 * 60 * 60 * 1_000;

export async function checkDatabaseConnection(): Promise<boolean> {
	try {
		if (dbConfig.dialect === Dialect.Postgres) {
			await (db as unknown as { execute(query: ReturnType<typeof sql>): Promise<unknown> }).execute(
				sql`select 1`,
			);
		} else {
			await db.run(sql`select 1`);
		}
		return true;
	} catch {
		return false;
	}
}

export async function listOrganizations(input: SearchPaginationInput) {
	const searchFilter = buildSearchFilter(input.search, s.organization.name, s.organization.slug);
	const memberCounts = db
		.select({
			orgId: s.orgMember.orgId,
			count: count().as('member_count'),
		})
		.from(s.orgMember)
		.groupBy(s.orgMember.orgId)
		.as('organization_member_counts');
	const projectCounts = db
		.select({
			orgId: s.project.orgId,
			count: count().as('project_count'),
		})
		.from(s.project)
		.groupBy(s.project.orgId)
		.as('organization_project_counts');
	const [items, totalRows] = await Promise.all([
		db
			.select({
				id: s.organization.id,
				name: s.organization.name,
				slug: s.organization.slug,
				googleClientId: s.organization.googleClientId,
				googleClientSecret: s.organization.googleClientSecret,
				googleAuthDomains: s.organization.googleAuthDomains,
				memberCount: memberCounts.count,
				projectCount: projectCounts.count,
				createdAt: s.organization.createdAt,
				updatedAt: s.organization.updatedAt,
			})
			.from(s.organization)
			.leftJoin(memberCounts, eq(memberCounts.orgId, s.organization.id))
			.leftJoin(projectCounts, eq(projectCounts.orgId, s.organization.id))
			.where(searchFilter)
			.orderBy(desc(s.organization.createdAt))
			.limit(input.limit)
			.offset(input.offset)
			.execute(),
		db.select({ count: count() }).from(s.organization).where(searchFilter).execute(),
	]);

	return {
		items: items.map((row) => ({
			id: row.id,
			name: row.name,
			slug: row.slug,
			googleAuthDomains: splitDomains(row.googleAuthDomains),
			hasGoogleSso: isSet(row.googleClientId) && isSet(row.googleClientSecret),
			memberCount: Number(row.memberCount ?? 0),
			projectCount: Number(row.projectCount ?? 0),
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		})),
		total: Number(totalRows[0]?.count ?? 0),
	};
}

export async function getOrganizationForBackoffice(orgId: string) {
	const [organization] = await db
		.select()
		.from(s.organization)
		.where(eq(s.organization.id, orgId))
		.limit(1)
		.execute();
	return organization ?? null;
}

export async function getOrganizationMembers(orgId: string) {
	return db
		.select({
			userId: s.user.id,
			name: s.user.name,
			email: s.user.email,
			role: s.orgMember.role,
			createdAt: s.orgMember.createdAt,
		})
		.from(s.orgMember)
		.innerJoin(s.user, eq(s.user.id, s.orgMember.userId))
		.where(eq(s.orgMember.orgId, orgId))
		.orderBy(asc(s.user.name))
		.execute();
}

export async function getOrganizationProjects(orgId: string) {
	const memberCounts = db
		.select({
			projectId: s.projectMember.projectId,
			count: count().as('project_member_count'),
		})
		.from(s.projectMember)
		.groupBy(s.projectMember.projectId)
		.as('project_member_counts');
	const rows = await db
		.select({
			id: s.project.id,
			name: s.project.name,
			type: s.project.type,
			path: s.project.path,
			memberCount: memberCounts.count,
			createdAt: s.project.createdAt,
			updatedAt: s.project.updatedAt,
		})
		.from(s.project)
		.leftJoin(memberCounts, eq(memberCounts.projectId, s.project.id))
		.where(eq(s.project.orgId, orgId))
		.orderBy(asc(s.project.name))
		.execute();
	return rows.map(({ path, ...row }) => ({
		...row,
		hasPath: isSet(path),
		memberCount: Number(row.memberCount ?? 0),
	}));
}

export async function getOrganizationApiKeys(orgId: string) {
	return db
		.select({
			id: s.apiKey.id,
			name: s.apiKey.name,
			keyPrefix: s.apiKey.keyPrefix,
			createdBy: s.apiKey.createdBy,
			createdByEmail: s.user.email,
			lastUsedAt: s.apiKey.lastUsedAt,
			createdAt: s.apiKey.createdAt,
		})
		.from(s.apiKey)
		.innerJoin(s.user, eq(s.user.id, s.apiKey.createdBy))
		.where(eq(s.apiKey.orgId, orgId))
		.orderBy(desc(s.apiKey.createdAt))
		.execute();
}

export async function listProjects(input: ProjectPaginationInput) {
	const cutoff = new Date(Date.now() - 30 * DAY_MS);
	const filters = [
		input.orgId ? eq(s.project.orgId, input.orgId) : undefined,
		buildSearchFilter(input.search, s.project.name),
	].filter(isDefined);
	const where = filters.length ? and(...filters) : undefined;
	const memberCounts = db
		.select({
			projectId: s.projectMember.projectId,
			count: count().as('project_member_count'),
		})
		.from(s.projectMember)
		.groupBy(s.projectMember.projectId)
		.as('project_member_counts');
	const messageCounts = db
		.select({
			projectId: s.chat.projectId,
			messages: count().as('project_messages'),
			errors: sql<number>`sum(case when ${s.chatMessage.errorMessage} is not null then 1 else 0 end)`.as(
				'project_errors',
			),
		})
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(gte(s.chatMessage.createdAt, cutoff))
		.groupBy(s.chat.projectId)
		.as('project_message_counts');
	const [items, totalRows] = await Promise.all([
		db
			.select({
				id: s.project.id,
				orgId: s.project.orgId,
				orgName: s.organization.name,
				name: s.project.name,
				type: s.project.type,
				path: s.project.path,
				memberCount: memberCounts.count,
				messages30d: messageCounts.messages,
				errors30d: messageCounts.errors,
				createdAt: s.project.createdAt,
				updatedAt: s.project.updatedAt,
			})
			.from(s.project)
			.leftJoin(s.organization, eq(s.organization.id, s.project.orgId))
			.leftJoin(memberCounts, eq(memberCounts.projectId, s.project.id))
			.leftJoin(messageCounts, eq(messageCounts.projectId, s.project.id))
			.where(where)
			.orderBy(desc(s.project.createdAt))
			.limit(input.limit)
			.offset(input.offset)
			.execute(),
		db.select({ count: count() }).from(s.project).where(where).execute(),
	]);

	return {
		items: items.map(({ path, ...row }) => ({
			...row,
			orgId: row.orgId ?? '',
			orgName: row.orgName ?? '',
			hasPath: isSet(path),
			memberCount: Number(row.memberCount ?? 0),
			messages30d: Number(row.messages30d ?? 0),
			errors30d: Number(row.errors30d ?? 0),
		})),
		total: Number(totalRows[0]?.count ?? 0),
	};
}

export async function getProjectForBackoffice(projectId: string) {
	const [project] = await db
		.select({
			id: s.project.id,
			orgId: s.project.orgId,
			orgName: s.organization.name,
			name: s.project.name,
			type: s.project.type,
			path: s.project.path,
			envVars: s.project.envVars,
			slackSettings: s.project.slackSettings,
			teamsSettings: s.project.teamsSettings,
			telegramSettings: s.project.telegramSettings,
			mattermostSettings: s.project.mattermostSettings,
			whatsappSettings: s.project.whatsappSettings,
			mcpEndpointSettings: s.project.mcpEndpointSettings,
			createdAt: s.project.createdAt,
			updatedAt: s.project.updatedAt,
		})
		.from(s.project)
		.leftJoin(s.organization, eq(s.organization.id, s.project.orgId))
		.where(eq(s.project.id, projectId))
		.limit(1)
		.execute();
	return project ?? null;
}

export async function getProjectMembers(projectId: string) {
	return db
		.select({
			userId: s.user.id,
			name: s.user.name,
			email: s.user.email,
			role: s.projectMember.role,
			createdAt: s.projectMember.createdAt,
		})
		.from(s.projectMember)
		.innerJoin(s.user, eq(s.user.id, s.projectMember.userId))
		.where(eq(s.projectMember.projectId, projectId))
		.orderBy(asc(s.user.name))
		.execute();
}

export async function getProjectSecretMetadata(projectId: string) {
	const [llmProviders, budgets] = await Promise.all([
		db
			.select({
				provider: s.projectLlmConfig.provider,
				apiKey: s.projectLlmConfig.apiKey,
				credentials: s.projectLlmConfig.credentials,
				baseUrl: s.projectLlmConfig.baseUrl,
				enabledModels: s.projectLlmConfig.enabledModels,
			})
			.from(s.projectLlmConfig)
			.where(eq(s.projectLlmConfig.projectId, projectId))
			.execute(),
		db
			.select({
				provider: s.projectProviderBudget.provider,
				limitUsd: s.projectProviderBudget.limitUsd,
				perUserLimitUsd: s.projectProviderBudget.perUserLimitUsd,
				period: s.projectProviderBudget.period,
				currentPeriodStart: s.projectProviderBudget.currentPeriodStart,
			})
			.from(s.projectProviderBudget)
			.where(eq(s.projectProviderBudget.projectId, projectId))
			.execute(),
	]);
	return { llmProviders, budgets };
}

function buildSearchFilter(search: string | undefined, ...columns: Array<{ getSQL(): unknown }>) {
	const normalized = search?.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}
	const pattern = `%${normalized}%`;
	return or(...columns.map((column) => sql`lower(${column}) like ${pattern}`));
}

function splitDomains(domains: string | null): string[] {
	return (domains ?? '')
		.split(',')
		.map((domain) => domain.trim())
		.filter(Boolean);
}

function isSet(value: unknown): boolean {
	return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}

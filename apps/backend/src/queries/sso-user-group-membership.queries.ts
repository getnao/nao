import { normalizeSsoGroupIdentifiers, parseStoredUserGroupSsoMappings, type SsoGroupProvider } from '@nao/shared';
import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm';

import type { DBUserGroup } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db, type DBExecutor, type DBTransaction } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';

export interface SsoUserGroupMapping {
	groupId: string;
	identifiers: string[];
}

export async function hasSsoUserGroupSyncState(userId: string, provider: SsoGroupProvider): Promise<boolean> {
	const [mappings, memberships] = await Promise.all([
		listAccessibleSsoUserGroupMappings(userId, provider),
		db
			.select({ groupId: s.userGroupSsoMember.groupId })
			.from(s.userGroupSsoMember)
			.where(and(eq(s.userGroupSsoMember.userId, userId), eq(s.userGroupSsoMember.provider, provider)))
			.limit(1)
			.execute(),
	]);
	return mappings.length > 0 || memberships.length > 0;
}

export async function reconcileSsoUserGroupMemberships(
	userId: string,
	provider: SsoGroupProvider,
	claimedIdentifiers: string[],
): Promise<void> {
	const identifiers = new Set(normalizeSsoGroupIdentifiers(provider, claimedIdentifiers));

	if (dbConfig.dialect === Dialect.Sqlite) {
		db.transaction(
			(transaction) => {
				const mappings = normalizeSsoUserGroupMappings(
					buildAccessibleSsoUserGroupMappingsQuery(transaction, userId).all(),
					provider,
				);
				const desiredGroupIds = getDesiredGroupIds(mappings, identifiers);
				const existingGroupIds = transaction
					.select({ groupId: s.userGroupSsoMember.groupId })
					.from(s.userGroupSsoMember)
					.where(and(eq(s.userGroupSsoMember.userId, userId), eq(s.userGroupSsoMember.provider, provider)))
					.all()
					.map(({ groupId }) => groupId);
				const changes = diffMemberships(existingGroupIds, desiredGroupIds);
				if (changes.stale.length > 0) {
					transaction
						.delete(s.userGroupSsoMember)
						.where(
							and(
								eq(s.userGroupSsoMember.userId, userId),
								eq(s.userGroupSsoMember.provider, provider),
								inArray(s.userGroupSsoMember.groupId, changes.stale),
							),
						)
						.run();
				}
				if (changes.added.length > 0) {
					transaction
						.insert(s.userGroupSsoMember)
						.values(changes.added.map((groupId) => ({ groupId, userId, provider })))
						.onConflictDoNothing()
						.run();
				}
			},
			{ behavior: 'immediate' },
		);
		return;
	}

	await db.transaction(async (transaction) => {
		await lockUserForSsoReconciliation(transaction, userId);
		const projectIds = await listAccessibleProjectIds(transaction, userId);
		await lockProjectsForSsoReconciliation(transaction, projectIds);
		const mappings = normalizeSsoUserGroupMappings(
			await buildAccessibleSsoUserGroupMappingsQuery(transaction, userId).execute(),
			provider,
		);
		const desiredGroupIds = getDesiredGroupIds(mappings, identifiers);
		const existingGroupIds = await transaction
			.select({ groupId: s.userGroupSsoMember.groupId })
			.from(s.userGroupSsoMember)
			.where(and(eq(s.userGroupSsoMember.userId, userId), eq(s.userGroupSsoMember.provider, provider)))
			.execute()
			.then((memberships) => memberships.map(({ groupId }) => groupId));
		const changes = diffMemberships(existingGroupIds, desiredGroupIds);
		if (changes.stale.length > 0) {
			await transaction
				.delete(s.userGroupSsoMember)
				.where(
					and(
						eq(s.userGroupSsoMember.userId, userId),
						eq(s.userGroupSsoMember.provider, provider),
						inArray(s.userGroupSsoMember.groupId, changes.stale),
					),
				)
				.execute();
		}
		if (changes.added.length > 0) {
			await transaction
				.insert(s.userGroupSsoMember)
				.values(changes.added.map((groupId) => ({ groupId, userId, provider })))
				.onConflictDoNothing()
				.execute();
		}
	});
}

export async function listAccessibleSsoUserGroupMappings(
	userId: string,
	provider: SsoGroupProvider,
): Promise<SsoUserGroupMapping[]> {
	const groups = await buildAccessibleSsoUserGroupMappingsQuery(db, userId).execute();
	return normalizeSsoUserGroupMappings(groups, provider);
}

export async function listConfiguredSsoGroupIdentifiers(userId: string, provider: SsoGroupProvider): Promise<string[]> {
	const mappings = await listAccessibleSsoUserGroupMappings(userId, provider);
	return [...new Set(mappings.flatMap((mapping) => mapping.identifiers))];
}

function buildAccessibleSsoUserGroupMappingsQuery(executor: DBExecutor, userId: string) {
	return executor
		.select({
			groupId: s.userGroup.id,
			isDefault: s.userGroup.isDefault,
			ssoMappings: s.userGroup.ssoMappings,
		})
		.from(s.userGroup)
		.innerJoin(s.project, eq(s.project.id, s.userGroup.projectId))
		.leftJoin(s.projectMember, and(eq(s.projectMember.projectId, s.project.id), eq(s.projectMember.userId, userId)))
		.leftJoin(s.orgMember, and(eq(s.orgMember.orgId, s.project.orgId), eq(s.orgMember.userId, userId)))
		.where(or(isNotNull(s.projectMember.userId), isNotNull(s.orgMember.userId)));
}

function normalizeSsoUserGroupMappings(
	groups: Array<{ groupId: string; isDefault: boolean; ssoMappings: DBUserGroup['ssoMappings'] }>,
	provider: SsoGroupProvider,
): SsoUserGroupMapping[] {
	return groups.flatMap((group) => {
		const identifiers = parseStoredUserGroupSsoMappings(group.ssoMappings).providers[provider];
		return !group.isDefault && identifiers.length > 0 ? [{ groupId: group.groupId, identifiers }] : [];
	});
}

function getDesiredGroupIds(mappings: SsoUserGroupMapping[], identifiers: Set<string>): Set<string> {
	return new Set(
		mappings
			.filter((mapping) => mapping.identifiers.some((identifier) => identifiers.has(identifier)))
			.map((mapping) => mapping.groupId),
	);
}

async function lockUserForSsoReconciliation(transaction: DBTransaction, userId: string): Promise<void> {
	const query = transaction.select({ id: s.user.id }).from(s.user).where(eq(s.user.id, userId));
	await (query as typeof query & { for(strength: 'update'): typeof query }).for('update').execute();
}

async function listAccessibleProjectIds(transaction: DBTransaction, userId: string): Promise<string[]> {
	const rows = await transaction
		.select({ id: s.project.id })
		.from(s.project)
		.leftJoin(s.projectMember, and(eq(s.projectMember.projectId, s.project.id), eq(s.projectMember.userId, userId)))
		.leftJoin(s.orgMember, and(eq(s.orgMember.orgId, s.project.orgId), eq(s.orgMember.userId, userId)))
		.where(or(isNotNull(s.projectMember.userId), isNotNull(s.orgMember.userId)))
		.execute();
	return [...new Set(rows.map(({ id }) => id))].sort();
}

async function lockProjectsForSsoReconciliation(transaction: DBTransaction, projectIds: string[]): Promise<void> {
	if (projectIds.length === 0) {
		return;
	}
	const query = transaction
		.select({ id: s.project.id })
		.from(s.project)
		.where(inArray(s.project.id, projectIds))
		.orderBy(asc(s.project.id));
	await (query as typeof query & { for(strength: 'update'): typeof query }).for('update').execute();
}

function diffMemberships(
	existingGroupIds: string[],
	desiredGroupIds: Set<string>,
): { stale: string[]; added: string[] } {
	const existing = new Set(existingGroupIds);
	return {
		stale: existingGroupIds.filter((groupId) => !desiredGroupIds.has(groupId)),
		added: [...desiredGroupIds].filter((groupId) => !existing.has(groupId)),
	};
}

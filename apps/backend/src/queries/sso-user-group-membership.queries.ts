import { normalizeSsoGroupIdentifiers, parseStoredUserGroupSsoMappings, type SsoGroupProvider } from '@nao/shared';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
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
	const mappings = await listAccessibleSsoUserGroupMappings(userId, provider);
	const identifiers = new Set(normalizeSsoGroupIdentifiers(provider, claimedIdentifiers));
	const desiredGroupIds = new Set(
		mappings
			.filter((mapping) => mapping.identifiers.some((identifier) => identifiers.has(identifier)))
			.map((mapping) => mapping.groupId),
	);

	if (dbConfig.dialect === Dialect.Sqlite) {
		db.transaction((transaction) => {
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
		});
		return;
	}

	await db.transaction(async (transaction) => {
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
	const groups = await db
		.select({
			groupId: s.userGroup.id,
			isDefault: s.userGroup.isDefault,
			ssoMappings: s.userGroup.ssoMappings,
		})
		.from(s.userGroup)
		.innerJoin(s.project, eq(s.project.id, s.userGroup.projectId))
		.leftJoin(s.projectMember, and(eq(s.projectMember.projectId, s.project.id), eq(s.projectMember.userId, userId)))
		.leftJoin(s.orgMember, and(eq(s.orgMember.orgId, s.project.orgId), eq(s.orgMember.userId, userId)))
		.where(or(isNotNull(s.projectMember.userId), isNotNull(s.orgMember.userId)))
		.execute();

	return groups.flatMap((group) => {
		const identifiers = parseStoredUserGroupSsoMappings(group.ssoMappings).providers[provider];
		return !group.isDefault && identifiers.length > 0 ? [{ groupId: group.groupId, identifiers }] : [];
	});
}

export async function listConfiguredSsoGroupIdentifiers(userId: string, provider: SsoGroupProvider): Promise<string[]> {
	const mappings = await listAccessibleSsoUserGroupMappings(userId, provider);
	return [...new Set(mappings.flatMap((mapping) => mapping.identifiers))];
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

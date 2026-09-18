import {
	FREE_CUSTOM_USER_GROUP_LIMIT,
	normalizeSsoGroupIdentifiers,
	parseStoredUserGroupSsoMappings,
	type SsoGroupProvider,
} from '@nao/shared';
import type { UserRole } from '@nao/shared/types';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { DBUserGroup } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db, type DBExecutor, type DBTransaction } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import {
	type EntraGroupNaoGroupMapping,
	type OidcGroupNaoGroupMapping,
	resolveEntraGroupNaoGroupMappings,
	resolveEntraGroupNaoGroupMappingTargets,
	resolveOidcGroupNaoGroupMappings,
	resolveOidcGroupNaoGroupMappingTargets,
	resolveStrongestUserRole,
} from '../utils/sso-group-mapping';

export interface SsoUserGroupMapping {
	groupId: string;
	projectId: string;
	groupName: string;
	identifiers: string[];
	defaultProjectRole: UserRole | null;
	hasProjectMembership: boolean;
	hasProjectAccess: boolean;
}

export interface SsoUserGroupReconciliationOptions {
	hasUnlimitedUserGroups?: boolean;
	oidcMappings?: OidcGroupNaoGroupMapping[];
	entraMappings?: EntraGroupNaoGroupMapping[];
}

export async function hasSsoUserGroupSyncState(userId: string, provider: SsoGroupProvider): Promise<boolean> {
	const [mappings, memberships] = await Promise.all([
		listAccessibleSsoUserGroupMappings(userId, provider),
		db
			.select({ groupId: s.userGroupMember.groupId })
			.from(s.userGroupMember)
			.where(and(eq(s.userGroupMember.userId, userId), eq(s.userGroupMember.provider, provider)))
			.limit(1)
			.execute(),
	]);
	return mappings.length > 0 || memberships.length > 0;
}

export async function reconcileSsoUserGroupMemberships(
	userId: string,
	provider: SsoGroupProvider,
	claimedIdentifiers: string[],
	options: SsoUserGroupReconciliationOptions = {},
): Promise<void> {
	const identifiers = new Set(normalizeSsoGroupIdentifiers(provider, claimedIdentifiers));

	if (dbConfig.dialect === Dialect.Sqlite) {
		db.transaction(
			(transaction) => {
				const mappings = normalizeSsoUserGroupMappings(
					buildSsoUserGroupMappingsQuery(transaction, userId).all(),
					provider,
					options.hasUnlimitedUserGroups ?? true,
				);
				const desired = getDesiredMemberships(
					mappings,
					identifiers,
					provider,
					options.oidcMappings ?? [],
					options.entraMappings ?? [],
				);
				insertMissingProjectMembershipsSqlite(transaction, userId, desired.projectRoles);
				const existingGroupIds = transaction
					.select({ groupId: s.userGroupMember.groupId })
					.from(s.userGroupMember)
					.where(and(eq(s.userGroupMember.userId, userId), eq(s.userGroupMember.provider, provider)))
					.all()
					.map(({ groupId }) => groupId);
				const changes = diffMemberships(existingGroupIds, desired.groupIds);
				if (changes.stale.length > 0) {
					transaction
						.delete(s.userGroupMember)
						.where(
							and(
								eq(s.userGroupMember.userId, userId),
								eq(s.userGroupMember.provider, provider),
								inArray(s.userGroupMember.groupId, changes.stale),
							),
						)
						.run();
				}
				if (changes.added.length > 0) {
					transaction
						.insert(s.userGroupMember)
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
		const projectIds = await listSsoCandidateProjectIds(transaction);
		await lockProjectsForSsoReconciliation(transaction, projectIds);
		const mappings = normalizeSsoUserGroupMappings(
			await buildSsoUserGroupMappingsQuery(transaction, userId).execute(),
			provider,
			options.hasUnlimitedUserGroups ?? true,
		);
		const desired = getDesiredMemberships(
			mappings,
			identifiers,
			provider,
			options.oidcMappings ?? [],
			options.entraMappings ?? [],
		);
		await insertMissingProjectMembershipsPostgres(transaction, userId, desired.projectRoles);
		const existingGroupIds = await transaction
			.select({ groupId: s.userGroupMember.groupId })
			.from(s.userGroupMember)
			.where(and(eq(s.userGroupMember.userId, userId), eq(s.userGroupMember.provider, provider)))
			.execute()
			.then((memberships) => memberships.map(({ groupId }) => groupId));
		const changes = diffMemberships(existingGroupIds, desired.groupIds);
		if (changes.stale.length > 0) {
			await transaction
				.delete(s.userGroupMember)
				.where(
					and(
						eq(s.userGroupMember.userId, userId),
						eq(s.userGroupMember.provider, provider),
						inArray(s.userGroupMember.groupId, changes.stale),
					),
				)
				.execute();
		}
		if (changes.added.length > 0) {
			await transaction
				.insert(s.userGroupMember)
				.values(changes.added.map((groupId) => ({ groupId, userId, provider })))
				.onConflictDoNothing()
				.execute();
		}
	});
}

export async function listAccessibleSsoUserGroupMappings(
	userId: string,
	provider: SsoGroupProvider,
	hasUnlimitedUserGroups = true,
): Promise<SsoUserGroupMapping[]> {
	const groups = await buildSsoUserGroupMappingsQuery(db, userId).execute();
	return normalizeSsoUserGroupMappings(groups, provider, hasUnlimitedUserGroups).filter(
		(mapping) => mapping.identifiers.length > 0 && (mapping.hasProjectAccess || mapping.defaultProjectRole),
	);
}

export async function listConfiguredSsoGroupIdentifiers(
	userId: string,
	provider: SsoGroupProvider,
	hasUnlimitedUserGroups = true,
): Promise<string[]> {
	const mappings = await listAccessibleSsoUserGroupMappings(userId, provider, hasUnlimitedUserGroups);
	return [...new Set(mappings.flatMap((mapping) => mapping.identifiers))];
}

function buildSsoUserGroupMappingsQuery(executor: DBExecutor, userId: string) {
	return executor
		.select({
			groupId: s.userGroup.id,
			projectId: s.userGroup.projectId,
			groupName: s.userGroup.name,
			isDefault: s.userGroup.isDefault,
			ssoMappings: s.userGroup.ssoMappings,
			createdAt: s.userGroup.createdAt,
			projectMemberUserId: s.projectMember.userId,
			orgMemberUserId: s.orgMember.userId,
		})
		.from(s.userGroup)
		.innerJoin(s.project, eq(s.project.id, s.userGroup.projectId))
		.leftJoin(s.projectMember, and(eq(s.projectMember.projectId, s.project.id), eq(s.projectMember.userId, userId)))
		.leftJoin(s.orgMember, and(eq(s.orgMember.orgId, s.project.orgId), eq(s.orgMember.userId, userId)));
}

function normalizeSsoUserGroupMappings(
	groups: Array<{
		groupId: string;
		projectId: string;
		groupName: string;
		isDefault: boolean;
		ssoMappings: DBUserGroup['ssoMappings'];
		createdAt: Date;
		projectMemberUserId: string | null;
		orgMemberUserId: string | null;
	}>,
	provider: SsoGroupProvider,
	hasUnlimitedUserGroups: boolean,
): SsoUserGroupMapping[] {
	const activeGroupIds = getActiveCustomGroupIds(groups, hasUnlimitedUserGroups);
	return groups.flatMap((group) => {
		if (group.isDefault || !activeGroupIds.has(group.groupId)) {
			return [];
		}
		const mappings = parseStoredUserGroupSsoMappings(group.ssoMappings);
		return [
			{
				groupId: group.groupId,
				projectId: group.projectId,
				groupName: group.groupName,
				identifiers: mappings.providers[provider],
				defaultProjectRole: mappings.defaultProjectRole ?? null,
				hasProjectMembership: group.projectMemberUserId !== null,
				hasProjectAccess: group.projectMemberUserId !== null || group.orgMemberUserId !== null,
			},
		];
	});
}

function getDesiredMemberships(
	mappings: SsoUserGroupMapping[],
	identifiers: Set<string>,
	provider: SsoGroupProvider,
	oidcMappings: OidcGroupNaoGroupMapping[],
	entraMappings: EntraGroupNaoGroupMapping[],
): { groupIds: Set<string>; projectRoles: Map<string, UserRole> } {
	const matchedByProject = new Map<string, SsoUserGroupMapping[]>();
	for (const mapping of mappings) {
		if (!isMappingMatched(mapping, mappings, identifiers, provider, oidcMappings, entraMappings)) {
			continue;
		}
		const projectMappings = matchedByProject.get(mapping.projectId) ?? [];
		projectMappings.push(mapping);
		matchedByProject.set(mapping.projectId, projectMappings);
	}

	const groupIds = new Set<string>();
	const projectRoles = new Map<string, UserRole>();
	for (const [projectId, projectMappings] of matchedByProject) {
		const role = resolveStrongestUserRole(
			projectMappings.flatMap((mapping) => (mapping.defaultProjectRole ? [mapping.defaultProjectRole] : [])),
		);
		const hasProjectMembership = projectMappings.some((mapping) => mapping.hasProjectMembership);
		const hasProjectAccess = projectMappings.some((mapping) => mapping.hasProjectAccess);
		if (!hasProjectAccess && !role) {
			continue;
		}
		if (!hasProjectMembership && role) {
			projectRoles.set(projectId, role);
		}
		for (const mapping of projectMappings) {
			groupIds.add(mapping.groupId);
		}
	}
	return { groupIds, projectRoles };
}

function isMappingMatched(
	mapping: SsoUserGroupMapping,
	availableMappings: SsoUserGroupMapping[],
	identifiers: Set<string>,
	provider: SsoGroupProvider,
	oidcMappings: OidcGroupNaoGroupMapping[],
	entraMappings: EntraGroupNaoGroupMapping[],
): boolean {
	const availableTargets = availableMappings
		.filter((candidate) => candidate.projectId === mapping.projectId)
		.map((candidate) => ({ id: candidate.groupId, name: candidate.groupName }));
	const resolvedEnvMappings =
		provider === 'oidc'
			? resolveOidcGroupNaoGroupMappingTargets(
					mapping.projectId,
					oidcMappings.filter((envMapping) => identifiers.has(envMapping.oidcGroup)),
					availableTargets,
				)
			: resolveEntraGroupNaoGroupMappingTargets(
					mapping.projectId,
					entraMappings.filter((envMapping) => identifiers.has(envMapping.entraGroupId)),
					availableTargets,
				);
	const selectedEnvMappings =
		provider === 'oidc'
			? resolveOidcGroupNaoGroupMappings([...identifiers], mapping.projectId, oidcMappings)
			: resolveEntraGroupNaoGroupMappings([...identifiers], mapping.projectId, entraMappings);
	const matchesEnv = [...resolvedEnvMappings.values()].some((target) => target.id === mapping.groupId);
	const matchesUi = mapping.identifiers.some(
		(identifier) => identifiers.has(identifier) && !selectedEnvMappings.has(identifier),
	);
	return matchesEnv || matchesUi;
}

function getActiveCustomGroupIds(
	groups: Array<{ groupId: string; projectId: string; isDefault: boolean; createdAt: Date }>,
	hasUnlimitedUserGroups: boolean,
): Set<string> {
	const customGroups = groups.filter((group) => !group.isDefault);
	if (hasUnlimitedUserGroups) {
		return new Set(customGroups.map((group) => group.groupId));
	}

	const groupsByProject = new Map<string, typeof customGroups>();
	for (const group of customGroups) {
		const projectGroups = groupsByProject.get(group.projectId) ?? [];
		projectGroups.push(group);
		groupsByProject.set(group.projectId, projectGroups);
	}
	return new Set(
		[...groupsByProject.values()].flatMap((projectGroups) =>
			projectGroups
				.sort(
					(left, right) =>
						left.createdAt.getTime() - right.createdAt.getTime() ||
						left.groupId.localeCompare(right.groupId),
				)
				.slice(0, FREE_CUSTOM_USER_GROUP_LIMIT)
				.map((group) => group.groupId),
		),
	);
}

function insertMissingProjectMembershipsSqlite(
	transaction: DBTransaction,
	userId: string,
	projectRoles: Map<string, UserRole>,
): void {
	if (projectRoles.size === 0) {
		return;
	}
	transaction
		.insert(s.projectMember)
		.values([...projectRoles].map(([projectId, role]) => ({ projectId, userId, role })))
		.onConflictDoNothing()
		.run();
}

async function insertMissingProjectMembershipsPostgres(
	transaction: DBTransaction,
	userId: string,
	projectRoles: Map<string, UserRole>,
): Promise<void> {
	if (projectRoles.size === 0) {
		return;
	}
	await transaction
		.insert(s.projectMember)
		.values([...projectRoles].map(([projectId, role]) => ({ projectId, userId, role })))
		.onConflictDoNothing()
		.execute();
}

async function lockUserForSsoReconciliation(transaction: DBTransaction, userId: string): Promise<void> {
	const query = transaction.select({ id: s.user.id }).from(s.user).where(eq(s.user.id, userId));
	await (query as typeof query & { for(strength: 'update'): typeof query }).for('update').execute();
}

async function listSsoCandidateProjectIds(transaction: DBTransaction): Promise<string[]> {
	const rows = await transaction
		.select({ id: s.userGroup.projectId })
		.from(s.userGroup)
		.where(eq(s.userGroup.isDefault, false))
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

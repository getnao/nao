import { serializeUserGroupConfig, serializeUserGroupContextAccess, serializeUserGroupRowPolicies } from '@nao/shared';
import { DEFAULT_MEMBER_BUDGET_PERIOD } from '@nao/shared/member-budget';
import { and, eq, inArray, ne } from 'drizzle-orm';

import type { NewUserGroup } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db, type DBTransaction } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { createActivity } from '../queries/activity.queries';
import type {
	NormalizedConfiguredUserGroup,
	NormalizedUserGroupsConfig,
	NormalizedUserGroupSettings,
} from './user-group-config.service';
import { UserGroupConfigError } from './user-group-config.service';
import type { UserGroupConfigDiff } from './user-group-config-diff.service';
import { diffUserGroupsConfig } from './user-group-config-diff.service';
import { withUserGroupConfigLock } from './user-group-config-lock.service';
import { listUsersEligibleForUserGroupConfig } from './user-group-config-membership.service';
import { getUserGroupManagementMode } from './user-group-management.service';
import { revokeUnauthorizedProjectWideShares } from './project-sharing.service';

export { withUserGroupConfigLock } from './user-group-config-lock.service';

type ReconciliationKind = 'enable' | 'apply' | 'disable';

interface DatabaseOperation {
	sqlite(transaction: DBTransaction): void;
	postgres(transaction: DBTransaction): Promise<void>;
}

export async function reconcileUserGroupsConfig(
	projectId: string,
	config: NormalizedUserGroupsConfig,
	actorUserId: string,
	deployId?: string,
): Promise<UserGroupConfigDiff> {
	return withUserGroupConfigLock(projectId, () =>
		reconcileUserGroupsConfigWithinLock(projectId, config, actorUserId, deployId),
	);
}

export async function reconcileUserGroupsConfigWithinLock(
	projectId: string,
	config: NormalizedUserGroupsConfig,
	actorUserId: string,
	deployId?: string,
): Promise<UserGroupConfigDiff> {
	const mode = await getUserGroupManagementMode(projectId);
	const kind: ReconciliationKind = mode === 'ui' ? 'enable' : 'apply';
	try {
		const diff = await diffUserGroupsConfig(projectId, config);
		await applyConfig(projectId, config, actorUserId, diff, kind, deployId);
		await revokeUnauthorizedProjectWideShares(projectId);
		return diff;
	} catch (error) {
		await recordUserGroupConfigFailure(projectId, actorUserId, kind, config.hash, error);
		throw error;
	}
}

export async function disableCodeManagedUserGroups(projectId: string, actorUserId: string): Promise<void> {
	await withUserGroupConfigLock(projectId, async () => {
		try {
			if ((await getUserGroupManagementMode(projectId)) !== 'code') {
				throw new UserGroupConfigError('User groups are already managed in the UI.');
			}
			const groups = await db
				.select({ id: s.userGroup.id })
				.from(s.userGroup)
				.where(and(eq(s.userGroup.projectId, projectId), eq(s.userGroup.isDefault, false)))
				.execute();
			const groupIds = groups.map((group) => group.id);
			const configMemberships =
				groupIds.length === 0
					? []
					: await db
							.select({ groupId: s.userGroupMember.groupId, userId: s.userGroupMember.userId })
							.from(s.userGroupMember)
							.where(
								and(
									inArray(s.userGroupMember.groupId, groupIds),
									eq(s.userGroupMember.provider, 'config'),
									eq(s.userGroupMember.active, true),
								),
							)
							.execute();
			const operations: DatabaseOperation[] = [];
			const actor = await getActorSnapshot(actorUserId);
			if (groupIds.length > 0) {
				operations.push(
					updateOperation((transaction) =>
						transaction
							.update(s.userGroupMember)
							.set({ active: false })
							.where(
								and(
									inArray(s.userGroupMember.groupId, groupIds),
									eq(s.userGroupMember.provider, 'config'),
								),
							),
					),
					updateOperation((transaction) =>
						transaction
							.update(s.userGroupConfigMember)
							.set({ active: false, updatedAt: new Date() })
							.where(inArray(s.userGroupConfigMember.groupId, groupIds)),
					),
				);
			}
			for (const membership of configMemberships) {
				operations.push(
					insertOperation((transaction) =>
						transaction
							.insert(s.userGroupMember)
							.values({ ...membership, provider: 'manual', active: true })
							.onConflictDoUpdate({
								target: [
									s.userGroupMember.groupId,
									s.userGroupMember.userId,
									s.userGroupMember.provider,
								],
								set: { active: true, createdAt: new Date() },
							}),
					),
				);
			}
			operations.push(
				updateOperation((transaction) =>
					transaction
						.update(s.project)
						.set({ userGroupManagementMode: 'ui', updatedAt: new Date() })
						.where(eq(s.project.id, projectId)),
				),
				auditOperation(projectId, actorUserId, actor, 'disable', null, {
					reactivatedManualMemberships: configMemberships.length,
				}),
			);
			await executeOperations(operations);
		} catch (error) {
			await recordUserGroupConfigFailure(projectId, actorUserId, 'disable', null, error);
			throw error;
		}
	});
}

async function applyConfig(
	projectId: string,
	config: NormalizedUserGroupsConfig,
	actorUserId: string,
	diff: UserGroupConfigDiff,
	kind: Exclude<ReconciliationKind, 'disable'>,
	deployId?: string,
): Promise<void> {
	const configuredEmails = config.groups.flatMap((group) => group.members);
	const [storedGroups, users, actor] = await Promise.all([
		db.select().from(s.userGroup).where(eq(s.userGroup.projectId, projectId)).execute(),
		listUsersEligibleForUserGroupConfig(projectId, configuredEmails),
		getActorSnapshot(actorUserId),
	]);
	const defaultGroup = storedGroups.find((group) => group.isDefault);
	if (!defaultGroup) {
		throw new UserGroupConfigError('The All Users group is missing.');
	}
	const now = new Date();
	const activeCustomGroups = storedGroups.filter((group) => !group.isDefault && !group.archivedAt);
	const groupsByKey = new Map(storedGroups.flatMap((group) => (group.configKey ? [[group.configKey, group]] : [])));
	const groupsByName = new Map(activeCustomGroups.map((group) => [group.name, group]));
	const desiredGroups = config.groups.map((desired) => {
		const existing = kind === 'enable' ? groupsByName.get(desired.name) : groupsByKey.get(desired.key);
		return { desired, id: existing?.id ?? crypto.randomUUID(), existing };
	});
	const idsByKey = new Map(desiredGroups.map((group) => [group.desired.key, group.id]));
	const desiredKeys = new Set(config.groups.map((group) => group.key));
	const archivedGroups =
		kind === 'apply'
			? activeCustomGroups.filter((group) => group.configKey && !desiredKeys.has(group.configKey))
			: [];
	const changedExistingIds = new Set(
		diff.groups.flatMap((change) => (change.groupId && change.action !== 'unchanged' ? [change.groupId] : [])),
	);
	const operations: DatabaseOperation[] = [];

	for (const group of [
		...archivedGroups,
		...activeCustomGroups.filter((group) => changedExistingIds.has(group.id)),
	]) {
		operations.push(
			updateOperation((transaction) =>
				transaction
					.update(s.userGroup)
					.set({ name: tombstoneName(group.id), updatedAt: now })
					.where(eq(s.userGroup.id, group.id)),
			),
		);
	}
	for (const group of archivedGroups) {
		operations.push(
			updateOperation((transaction) =>
				transaction
					.update(s.userGroup)
					.set({
						archivedAt: now,
						archivedName: group.name,
						updatedAt: now,
					})
					.where(eq(s.userGroup.id, group.id)),
			),
			updateOperation((transaction) =>
				transaction
					.update(s.userGroupMember)
					.set({ active: false })
					.where(eq(s.userGroupMember.groupId, group.id)),
			),
			updateOperation((transaction) =>
				transaction
					.update(s.userGroupConfigMember)
					.set({ active: false, updatedAt: now })
					.where(eq(s.userGroupConfigMember.groupId, group.id)),
			),
			updateOperation((transaction) =>
				transaction
					.update(s.projectGroupBudget)
					.set({ active: false, updatedAt: now })
					.where(eq(s.projectGroupBudget.groupId, group.id)),
			),
		);
	}
	if (kind === 'enable') {
		const customGroupIds = storedGroups.filter((group) => !group.isDefault).map((group) => group.id);
		if (customGroupIds.length > 0) {
			operations.push(
				updateOperation((transaction) =>
					transaction
						.update(s.userGroupMember)
						.set({ active: false })
						.where(
							and(
								inArray(s.userGroupMember.groupId, customGroupIds),
								ne(s.userGroupMember.provider, 'config'),
							),
						),
				),
			);
		}
	}
	if (diff.allUsersChanged || kind === 'enable') {
		operations.push(
			updateOperation((transaction) =>
				transaction
					.update(s.userGroup)
					.set({ ...storedSettings(config.allUsers, idsByKey), updatedAt: now })
					.where(eq(s.userGroup.id, defaultGroup.id)),
			),
			defaultBudgetOperation(projectId, config.allUsers.budgetLimitUsd, now),
		);
	}
	for (const group of desiredGroups) {
		const action = diff.groups.find((change) => change.key === group.desired.key)?.action;
		if (!group.existing) {
			const values: NewUserGroup = {
				id: group.id,
				projectId,
				name: tombstoneName(group.id),
				isDefault: false,
				configKey: group.desired.key,
				...storedSettings(group.desired, idsByKey),
				ssoMappingsSuspendedAt: kind === 'enable' ? now : null,
			};
			operations.push(insertOperation((transaction) => transaction.insert(s.userGroup).values(values)));
		}
		if (kind === 'enable' || action !== 'unchanged') {
			operations.push(
				updateOperation((transaction) =>
					transaction
						.update(s.userGroup)
						.set({
							name: group.desired.name,
							configKey: group.desired.key,
							archivedAt: null,
							archivedName: null,
							...(kind === 'enable' ? { ssoMappingsSuspendedAt: now } : {}),
							...storedSettings(group.desired, idsByKey),
							updatedAt: now,
						})
						.where(eq(s.userGroup.id, group.id)),
				),
			);
		}
		if (kind === 'enable' || action !== 'unchanged') {
			operations.push(...membershipOperations(group, users, now));
			operations.push(groupBudgetOperation(projectId, group.id, group.desired.budgetLimitUsd, now));
		}
	}
	if (kind === 'enable') {
		operations.push(
			updateOperation((transaction) =>
				transaction
					.update(s.project)
					.set({ userGroupManagementMode: 'code', updatedAt: now })
					.where(eq(s.project.id, projectId)),
			),
		);
	}
	operations.push(
		auditOperation(
			projectId,
			actorUserId,
			actor,
			kind,
			config.hash,
			{
				...diff.summary,
				allUsersChanged: diff.allUsersChanged,
				pendingEmails: diff.pendingEmails.length,
				chatShareRevocations: diff.shareRevocations.chats,
				storyShareRevocations: diff.shareRevocations.stories,
			},
			deployId,
		),
	);
	await executeOperations(operations);
}

function membershipOperations(
	group: {
		desired: NormalizedConfiguredUserGroup;
		id: string;
	},
	users: Array<{ id: string; email: string }>,
	now: Date,
): DatabaseOperation[] {
	const usersByEmail = new Map(users.map((user) => [user.email.trim().toLowerCase(), user.id]));
	const operations: DatabaseOperation[] = [
		updateOperation((transaction) =>
			transaction
				.update(s.userGroupConfigMember)
				.set({ active: false, updatedAt: now })
				.where(eq(s.userGroupConfigMember.groupId, group.id)),
		),
		updateOperation((transaction) =>
			transaction
				.update(s.userGroupMember)
				.set({ active: false })
				.where(and(eq(s.userGroupMember.groupId, group.id), eq(s.userGroupMember.provider, 'config'))),
		),
	];
	for (const normalizedEmail of group.desired.members) {
		operations.push(
			insertOperation((transaction) =>
				transaction
					.insert(s.userGroupConfigMember)
					.values({ groupId: group.id, normalizedEmail, active: true })
					.onConflictDoUpdate({
						target: [s.userGroupConfigMember.groupId, s.userGroupConfigMember.normalizedEmail],
						set: { active: true, updatedAt: now },
					}),
			),
		);
		const userId = usersByEmail.get(normalizedEmail);
		if (userId) {
			operations.push(
				insertOperation((transaction) =>
					transaction
						.insert(s.userGroupMember)
						.values({ groupId: group.id, userId, provider: 'config', active: true })
						.onConflictDoUpdate({
							target: [s.userGroupMember.groupId, s.userGroupMember.userId, s.userGroupMember.provider],
							set: { active: true, createdAt: now },
						}),
				),
			);
		}
	}
	return operations;
}

function groupBudgetOperation(
	projectId: string,
	groupId: string,
	limitUsd: number | null,
	now: Date,
): DatabaseOperation {
	if (limitUsd === null) {
		return updateOperation((transaction) =>
			transaction
				.update(s.projectGroupBudget)
				.set({ active: false, updatedAt: now })
				.where(and(eq(s.projectGroupBudget.projectId, projectId), eq(s.projectGroupBudget.groupId, groupId))),
		);
	}
	return insertOperation((transaction) =>
		transaction
			.insert(s.projectGroupBudget)
			.values({ projectId, groupId, limitUsd, active: true })
			.onConflictDoUpdate({
				target: s.projectGroupBudget.groupId,
				set: { limitUsd, active: true, updatedAt: now },
			}),
	);
}

function defaultBudgetOperation(projectId: string, limitUsd: number | null, now: Date): DatabaseOperation {
	return insertOperation((transaction) =>
		transaction
			.insert(s.projectMemberBudgetSettings)
			.values({
				projectId,
				period: DEFAULT_MEMBER_BUDGET_PERIOD,
				defaultLimitUsd: limitUsd ?? 0,
			})
			.onConflictDoUpdate({
				target: s.projectMemberBudgetSettings.projectId,
				set: { defaultLimitUsd: limitUsd ?? 0, updatedAt: now },
			}),
	);
}

function storedSettings(
	settings: NormalizedUserGroupSettings,
	idsByKey: ReadonlyMap<string, string>,
): Pick<NewUserGroup, 'featureGrants' | 'contextGrants' | 'rowPolicies'> {
	return {
		featureGrants: serializeUserGroupConfig(
			settings.features,
			settings.toolCallDensityPolicy,
			settings.projectSharing,
			settings.showAllSettings,
			settings.preloadedSkills,
			{
				includeOwnGroup: settings.shareTargets.includeOwnGroup,
				groupIds: settings.shareTargets.groupKeys.map((key) => idsByKey.get(key)!),
			},
		),
		contextGrants: serializeUserGroupContextAccess({
			databaseAccess: settings.databaseAccess,
			docsAccess: settings.docsAccess,
			filesAccess: settings.filesAccess,
			mcpAccess: settings.mcpAccess,
			skillsAccess: settings.skillsAccess,
		}),
		rowPolicies: serializeUserGroupRowPolicies(settings.rowPolicies),
	};
}

function tombstoneName(groupId: string): string {
	return `__archived_user_group_${groupId}`;
}

function updateOperation(
	build: (transaction: DBTransaction) => {
		run(): unknown;
		execute(): Promise<unknown>;
	},
): DatabaseOperation {
	return {
		sqlite: (transaction) => {
			build(transaction).run();
		},
		postgres: async (transaction) => {
			await build(transaction).execute();
		},
	};
}

function insertOperation(
	build: (transaction: DBTransaction) => {
		run(): unknown;
		execute(): Promise<unknown>;
	},
): DatabaseOperation {
	return updateOperation(build);
}

function auditOperation(
	projectId: string,
	actorUserId: string,
	actor: { name: string; email: string } | null,
	kind: ReconciliationKind,
	hash: string | null,
	summary: Record<string, unknown>,
	deployId?: string,
): DatabaseOperation {
	return insertOperation((transaction) =>
		transaction.insert(s.activity).values({
			...(deployId ? { id: deployId } : {}),
			projectId,
			userId: actorUserId,
			type: 'user-groups.config',
			status: 'completed',
			trigger: 'manual',
			payload: {
				kind,
				hash,
				...(deployId ? { deployId } : {}),
				actor: actor ? { id: actorUserId, ...actor } : { id: actorUserId },
				summary,
			},
			completedAt: new Date(),
		}),
	);
}

async function executeOperations(operations: DatabaseOperation[]): Promise<void> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		db.transaction(
			(transaction) => {
				for (const operation of operations) {
					operation.sqlite(transaction);
				}
			},
			{ behavior: 'immediate' },
		);
		return;
	}
	await db.transaction(async (transaction) => {
		for (const operation of operations) {
			await operation.postgres(transaction);
		}
	});
}

export async function recordUserGroupConfigFailure(
	projectId: string,
	actorUserId: string,
	kind: ReconciliationKind,
	hash: string | null,
	error: unknown,
): Promise<void> {
	const actor = await getActorSnapshot(actorUserId);
	const activity = await createActivity({
		projectId,
		userId: actorUserId,
		type: 'user-groups.config',
		trigger: 'manual',
		status: 'failed',
		payload: { kind, hash, actor: actor ? { id: actorUserId, ...actor } : { id: actorUserId } },
	});
	const message = error instanceof Error ? error.message : String(error);
	await db
		.update(s.activity)
		.set({ errorMessage: message, completedAt: new Date() })
		.where(eq(s.activity.id, activity.id))
		.execute();
}

async function getActorSnapshot(actorUserId: string): Promise<{ name: string; email: string } | null> {
	const [actor] = await db
		.select({ name: s.user.name, email: s.user.email })
		.from(s.user)
		.where(eq(s.user.id, actorUserId))
		.limit(1)
		.execute();
	return actor ?? null;
}

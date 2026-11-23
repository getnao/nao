import {
	serializeUserGroupConfig,
	serializeUserGroupContextAccess,
	serializeUserGroupRowPolicies,
	serializeUserGroupSsoMappings,
	type SsoGroupProvider,
} from '@nao/shared';
import { and, eq, inArray } from 'drizzle-orm';

import type { DBUserGroup, NewUserGroup } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db, type DBTransaction } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { isCloud } from '../env';
import * as activityQueries from '../queries/activity.queries';
import * as projectQueries from '../queries/project.queries';
import { getChangedSsoProviders } from '../queries/user-group.queries';
import { logger } from '../utils/logger';
import { revokeUnauthorizedProjectWideShares } from './project-sharing.service';
import type {
	NormalizedConfiguredUserGroup,
	NormalizedUserGroupsConfig,
	NormalizedUserGroupSettings,
} from './user-group-config.service';
import { USER_GROUPS_CONFIG_FILENAME, UserGroupConfigError } from './user-group-config.service';
import type { UserGroupConfigDiff } from './user-group-config-diff.service';
import { diffUserGroupsConfig, matchStoredUserGroups } from './user-group-config-diff.service';
import { withUserGroupConfigLock } from './user-group-config-lock.service';
import { listUsersEligibleForUserGroupConfig } from './user-group-config-membership.service';
import {
	readUserGroupsConfig,
	requireUserGroupsConfig,
	validateUserGroupsConfig,
} from './user-group-config-validation.service';
import { getUserGroupManagementMode } from './user-group-management.service';

export { withUserGroupConfigLock } from './user-group-config-lock.service';

type ReconciliationKind = 'enable' | 'apply';

interface DatabaseOperation {
	sqlite(transaction: DBTransaction): void;
	postgres(transaction: DBTransaction): Promise<void>;
}

interface DesiredGroup {
	desired: NormalizedConfiguredUserGroup;
	id: string;
	existing: DBUserGroup | undefined;
}

/** `actorUserId` is null when the server applies the file on its own, at startup. */
export async function reconcileUserGroupsConfig(
	projectId: string,
	config: NormalizedUserGroupsConfig,
	actorUserId: string | null,
	deployId?: string,
): Promise<UserGroupConfigDiff> {
	return withUserGroupConfigLock(projectId, () =>
		reconcileUserGroupsConfigWithinLock(projectId, config, actorUserId, deployId),
	);
}

export async function reconcileUserGroupsConfigWithinLock(
	projectId: string,
	config: NormalizedUserGroupsConfig,
	actorUserId: string | null,
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
		await recordUserGroupConfigFailure(projectId, actorUserId, config.hash, error);
		throw error;
	}
}

/**
 * Self-hosted servers refuse to start on an invalid or missing file. On Cloud one customer's file must not take the
 * others down, so the failure is only recorded and shown in that project's settings, and its last state is kept.
 */
export async function reconcileUserGroupsConfigsAtStartup(): Promise<void> {
	const failures: string[] = [];
	for (const project of await projectQueries.listProjectDeploymentPaths()) {
		try {
			await withUserGroupConfigLock(project.id, () =>
				reconcileProjectUserGroupsConfig(project.id, project.path, null),
			);
		} catch (error) {
			failures.push(`${project.name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (failures.length === 0) {
		return;
	}
	if (!isCloud) {
		throw new UserGroupConfigError(`${USER_GROUPS_CONFIG_FILENAME} could not be applied.\n${failures.join('\n')}`);
	}
	for (const failure of failures) {
		logger.error(`${USER_GROUPS_CONFIG_FILENAME} could not be applied at startup. ${failure}`, {
			source: 'system',
		});
	}
}

/** Applies the project folder's file when it differs from the last applied one. Must run within the config lock. */
export async function reconcileProjectUserGroupsConfig(
	projectId: string,
	projectPath: string,
	actorUserId: string | null,
): Promise<void> {
	const mode = await getUserGroupManagementMode(projectId);
	let config: NormalizedUserGroupsConfig | null = null;
	try {
		config = mode === 'code' ? requireUserGroupsConfig(projectPath) : readUserGroupsConfig(projectPath);
		if (!config || (await isLastAppliedUserGroupsConfig(projectId, config.hash))) {
			return;
		}
		await validateUserGroupsConfig({ projectId }, projectPath, config);
	} catch (error) {
		await recordUserGroupConfigFailure(projectId, actorUserId, config?.hash ?? null, error);
		throw error;
	}
	await reconcileUserGroupsConfigWithinLock(projectId, config, actorUserId);
}

async function isLastAppliedUserGroupsConfig(projectId: string, hash: string): Promise<boolean> {
	const { lastSuccess } = await activityQueries.listLatestUserGroupConfigActivities(projectId);
	return (lastSuccess?.payload as { hash?: string } | null)?.hash === hash;
}

async function applyConfig(
	projectId: string,
	config: NormalizedUserGroupsConfig,
	actorUserId: string | null,
	diff: UserGroupConfigDiff,
	kind: ReconciliationKind,
	deployId?: string,
): Promise<void> {
	const [storedGroups, users, actor] = await Promise.all([
		db.select().from(s.userGroup).where(eq(s.userGroup.projectId, projectId)).execute(),
		listUsersEligibleForUserGroupConfig(
			projectId,
			config.groups.flatMap((group) => group.members),
		),
		getActorSnapshot(actorUserId),
	]);
	const defaultGroup = storedGroups.find((group) => group.isDefault);
	if (!defaultGroup) {
		throw new UserGroupConfigError('The All Users group is missing.');
	}
	const now = new Date();
	const storedByKey = matchStoredUserGroups(storedGroups);
	const desiredGroups: DesiredGroup[] = config.groups.map((desired) => {
		const existing = storedByKey.get(desired.key);
		return { desired, id: existing?.id ?? crypto.randomUUID(), existing };
	});
	const idsByKey = new Map(desiredGroups.map((group) => [group.desired.key, group.id]));
	const actions = new Map(diff.groups.map((change) => [change.key, change.action]));
	const archivedGroups = diff.groups.flatMap((change) =>
		change.action === 'archived' ? [storedByKey.get(change.key)!] : [],
	);
	const renamedGroups = desiredGroups.filter(
		(group) => group.existing && !group.existing.archivedAt && actions.get(group.desired.key) !== 'unchanged',
	);
	const operations: DatabaseOperation[] = [];

	for (const group of [...archivedGroups, ...renamedGroups.map((renamed) => renamed.existing!)]) {
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
		operations.push(...archiveOperations(group, now));
	}
	if (kind === 'enable') {
		operations.push(...deactivateManualMembershipOperations(storedGroups));
	}
	if (diff.allUsersChanged || kind === 'enable') {
		operations.push(
			updateOperation((transaction) =>
				transaction
					.update(s.userGroup)
					.set({ ...storedSettings(config.allUsers, idsByKey), updatedAt: now })
					.where(eq(s.userGroup.id, defaultGroup.id)),
			),
		);
	}
	for (const group of desiredGroups) {
		if (actions.get(group.desired.key) === 'unchanged') {
			continue;
		}
		operations.push(...upsertGroupOperations(projectId, group, idsByKey, now));
		operations.push(...membershipOperations(group, users, now));
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
		auditOperation(projectId, actorUserId, actor, {
			status: 'completed',
			kind,
			hash: config.hash,
			deployId,
			summary: {
				...diff.summary,
				allUsersChanged: diff.allUsersChanged,
				pendingEmails: diff.pendingEmails.length,
				chatShareRevocations: diff.shareRevocations.chats,
				storyShareRevocations: diff.shareRevocations.stories,
			},
		}),
	);
	await executeOperations(operations);
}

function archiveOperations(group: DBUserGroup, now: Date): DatabaseOperation[] {
	return [
		updateOperation((transaction) =>
			transaction
				.update(s.userGroup)
				.set({ archivedAt: now, archivedName: group.name, updatedAt: now })
				.where(eq(s.userGroup.id, group.id)),
		),
		updateOperation((transaction) =>
			transaction.update(s.userGroupMember).set({ active: false }).where(eq(s.userGroupMember.groupId, group.id)),
		),
		updateOperation((transaction) =>
			transaction
				.update(s.userGroupConfigMember)
				.set({ active: false, updatedAt: now })
				.where(eq(s.userGroupConfigMember.groupId, group.id)),
		),
	];
}

/** From the first apply on, `list_of_emails` replaces the members picked in the UI. SSO members are kept. */
function deactivateManualMembershipOperations(storedGroups: DBUserGroup[]): DatabaseOperation[] {
	const customGroupIds = storedGroups.filter((group) => !group.isDefault).map((group) => group.id);
	if (customGroupIds.length === 0) {
		return [];
	}
	return [
		updateOperation((transaction) =>
			transaction
				.update(s.userGroupMember)
				.set({ active: false })
				.where(
					and(inArray(s.userGroupMember.groupId, customGroupIds), eq(s.userGroupMember.provider, 'manual')),
				),
		),
	];
}

function upsertGroupOperations(
	projectId: string,
	group: DesiredGroup,
	idsByKey: ReadonlyMap<string, string>,
	now: Date,
): DatabaseOperation[] {
	const values = {
		name: group.desired.name,
		configKey: group.desired.key,
		archivedAt: null,
		archivedName: null,
		ssoMappings: serializeUserGroupSsoMappings(group.desired.ssoMappings),
		...storedSettings(group.desired, idsByKey),
	};
	if (!group.existing) {
		const inserted: NewUserGroup = { id: group.id, projectId, isDefault: false, ...values };
		return [insertOperation((transaction) => transaction.insert(s.userGroup).values(inserted))];
	}
	const changedProviders = getChangedSsoProviders(group.existing.ssoMappings, values.ssoMappings);
	return [
		updateOperation((transaction) =>
			transaction
				.update(s.userGroup)
				.set({ ...values, updatedAt: now })
				.where(eq(s.userGroup.id, group.id)),
		),
		...deactivateSsoMembershipOperations(group.id, changedProviders),
	];
}

/** Members of a changed SSO mapping are dropped and re-evaluated at their next login. */
function deactivateSsoMembershipOperations(groupId: string, providers: SsoGroupProvider[]): DatabaseOperation[] {
	if (providers.length === 0) {
		return [];
	}
	return [
		updateOperation((transaction) =>
			transaction
				.update(s.userGroupMember)
				.set({ active: false })
				.where(and(eq(s.userGroupMember.groupId, groupId), inArray(s.userGroupMember.provider, providers))),
		),
	];
}

function membershipOperations(
	group: DesiredGroup,
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
			settings.advancedContextExplorer,
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
	actorUserId: string | null,
	actor: { name: string; email: string } | null,
	entry: {
		status: 'completed';
		kind: ReconciliationKind;
		hash: string;
		deployId?: string;
		summary: Record<string, unknown>;
	},
): DatabaseOperation {
	return insertOperation((transaction) =>
		transaction.insert(s.activity).values({
			...(entry.deployId ? { id: entry.deployId } : {}),
			projectId,
			userId: actorUserId,
			type: 'user-groups.config',
			status: entry.status,
			trigger: actorUserId ? 'manual' : 'system',
			payload: {
				kind: entry.kind,
				hash: entry.hash,
				...(entry.deployId ? { deployId: entry.deployId } : {}),
				actor: actorSnapshot(actorUserId, actor),
				summary: entry.summary,
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
	actorUserId: string | null,
	hash: string | null,
	error: unknown,
): Promise<void> {
	const actor = await getActorSnapshot(actorUserId);
	const activity = await activityQueries.createActivity({
		projectId,
		userId: actorUserId,
		type: 'user-groups.config',
		trigger: actorUserId ? 'manual' : 'system',
		status: 'failed',
		payload: { kind: 'apply', hash, actor: actorSnapshot(actorUserId, actor) },
	});
	const message = error instanceof Error ? error.message : String(error);
	await db
		.update(s.activity)
		.set({ errorMessage: message, completedAt: new Date() })
		.where(eq(s.activity.id, activity.id))
		.execute();
}

function actorSnapshot(
	actorUserId: string | null,
	actor: { name: string; email: string } | null,
): Record<string, unknown> | null {
	if (!actorUserId) {
		return null;
	}
	return actor ? { id: actorUserId, ...actor } : { id: actorUserId };
}

async function getActorSnapshot(actorUserId: string | null): Promise<{ name: string; email: string } | null> {
	if (!actorUserId) {
		return null;
	}
	const [actor] = await db
		.select({ name: s.user.name, email: s.user.email })
		.from(s.user)
		.where(eq(s.user.id, actorUserId))
		.limit(1)
		.execute();
	return actor ?? null;
}

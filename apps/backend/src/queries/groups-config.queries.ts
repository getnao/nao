import type { SsoGroupProvider } from '@nao/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';

import type { DBProject, DBUserGroup, NewProject, NewUserGroup } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db, type DBTransaction } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { createProjectWithDefaultGroup } from './project.queries';

interface DatabaseOperation {
	sqlite(transaction: DBTransaction): void;
	postgres(transaction: DBTransaction): Promise<void>;
}

export interface DesiredStoredGroup {
	id: string;
	existing?: DBUserGroup;
	values: NewUserGroup;
	memberUserIds: string[];
	changedSsoProviders: SsoGroupProvider[];
}

export interface GroupsConfigWritePlan {
	projectId: string;
	actorUserId: string | null;
	hash: string;
	allUsersId: string;
	allUsersExisting?: DBUserGroup;
	allUsersValues: Partial<NewUserGroup>;
	groups: DesiredStoredGroup[];
	archivedGroups: Array<{ group: DBUserGroup; configId: string }>;
}

export async function listStoredUserGroups(projectId: string): Promise<DBUserGroup[]> {
	return db.select().from(s.userGroup).where(eq(s.userGroup.projectId, projectId)).execute();
}

export async function isGroupsConfigManaged(projectId: string): Promise<boolean> {
	const [project] = await db
		.select({ appliedAt: s.project.userGroupsConfigAppliedAt })
		.from(s.project)
		.where(eq(s.project.id, projectId))
		.limit(1)
		.execute();
	return project?.appliedAt !== null && project?.appliedAt !== undefined;
}

export async function getLastAppliedGroupsConfigHash(projectId: string): Promise<string | null> {
	const [activity] = await db
		.select({ payload: s.activity.payload })
		.from(s.activity)
		.where(and(eq(s.activity.projectId, projectId), eq(s.activity.type, 'user_group.config_applied')))
		.orderBy(desc(s.activity.startedAt))
		.limit(1)
		.execute();
	const hash = activity?.payload?.hash;
	return typeof hash === 'string' ? hash : null;
}

export async function getGroupsConfigStatus(projectId: string): Promise<{
	appliedAt: Date | null;
	lastAttemptFailed: boolean;
	errorMessage: string | null;
}> {
	const [[project], attempts] = await Promise.all([
		db
			.select({ appliedAt: s.project.userGroupsConfigAppliedAt })
			.from(s.project)
			.where(eq(s.project.id, projectId))
			.limit(1)
			.execute(),
		db
			.select({ type: s.activity.type, errorMessage: s.activity.errorMessage })
			.from(s.activity)
			.where(
				and(
					eq(s.activity.projectId, projectId),
					inArray(s.activity.type, ['user_group.config_applied', 'user_group.config_failed']),
				),
			)
			.orderBy(desc(s.activity.startedAt))
			.limit(1)
			.execute(),
	]);
	return {
		appliedAt: project?.appliedAt ?? null,
		lastAttemptFailed: attempts[0]?.type === 'user_group.config_failed',
		errorMessage: attempts[0]?.errorMessage ?? null,
	};
}

export async function recordGroupsConfigFailure(
	projectId: string,
	actorUserId: string | null,
	error: unknown,
	hash: string | null,
): Promise<void> {
	await db
		.insert(s.activity)
		.values({
			projectId,
			userId: actorUserId,
			type: 'user_group.config_failed',
			status: 'failed',
			trigger: actorUserId ? 'manual' : 'system',
			payload: hash ? { hash } : undefined,
			errorMessage: error instanceof Error ? error.message : String(error),
			completedAt: new Date(),
		})
		.execute();
}

export async function applyGroupsConfigWritePlan(plan: GroupsConfigWritePlan): Promise<void> {
	const now = new Date();
	const operations = buildWriteOperations(plan, now);
	await executeOperations(operations, plan.projectId);
}

export async function createProjectWithGroupsConfig(
	project: NewProject,
	plan: GroupsConfigWritePlan,
): Promise<DBProject> {
	const operations = buildWriteOperations(plan, new Date());
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction(
			(transaction) => {
				const created = createProjectWithDefaultGroup(project, transaction, plan.allUsersId) as DBProject;
				for (const operation of operations) {
					operation.sqlite(transaction);
				}
				return created;
			},
			{ behavior: 'immediate' },
		);
	}
	return db.transaction(async (transaction) => {
		const created = (await createProjectWithDefaultGroup(project, transaction, plan.allUsersId)) as DBProject;
		for (const operation of operations) {
			await operation.postgres(transaction);
		}
		return created;
	});
}

function buildWriteOperations(plan: GroupsConfigWritePlan, now: Date): DatabaseOperation[] {
	const operations: DatabaseOperation[] = [];
	const groupsWhoseNamesMustMove = [
		...plan.archivedGroups.map(({ group }) => group),
		...plan.groups.flatMap((group) =>
			group.existing && group.existing.name !== group.values.name ? [group.existing] : [],
		),
	];

	for (const group of groupsWhoseNamesMustMove) {
		operations.push(
			writeOperation((transaction) =>
				transaction
					.update(s.userGroup)
					.set({ name: `__groups_config_${group.id}`, updatedAt: now })
					.where(eq(s.userGroup.id, group.id)),
			),
		);
	}
	for (const { group, configId } of plan.archivedGroups) {
		operations.push(
			writeOperation((transaction) =>
				transaction
					.update(s.userGroup)
					.set({
						name: `${group.name} (archived ${group.id.slice(0, 8)})`,
						configId,
						archivedAt: now,
						updatedAt: now,
					})
					.where(eq(s.userGroup.id, group.id)),
			),
			writeOperation((transaction) =>
				transaction.delete(s.userGroupMember).where(eq(s.userGroupMember.groupId, group.id)),
			),
		);
	}
	operations.push(
		writeOperation((transaction) =>
			transaction
				.update(s.userGroup)
				.set({ ...plan.allUsersValues, configId: 'all_users', archivedAt: null, updatedAt: now })
				.where(eq(s.userGroup.id, plan.allUsersId)),
		),
	);
	for (const group of plan.groups) {
		if (group.existing) {
			operations.push(
				writeOperation((transaction) =>
					transaction
						.update(s.userGroup)
						.set({ ...group.values, archivedAt: null, updatedAt: now })
						.where(eq(s.userGroup.id, group.id)),
				),
			);
		} else {
			operations.push(writeOperation((transaction) => transaction.insert(s.userGroup).values(group.values)));
		}
		operations.push(
			writeOperation((transaction) =>
				transaction
					.delete(s.userGroupMember)
					.where(and(eq(s.userGroupMember.groupId, group.id), eq(s.userGroupMember.provider, 'manual'))),
			),
		);
		if (group.changedSsoProviders.length > 0) {
			operations.push(
				writeOperation((transaction) =>
					transaction
						.delete(s.userGroupMember)
						.where(
							and(
								eq(s.userGroupMember.groupId, group.id),
								inArray(s.userGroupMember.provider, group.changedSsoProviders),
							),
						),
				),
			);
		}
		if (group.memberUserIds.length > 0) {
			operations.push(
				writeOperation((transaction) =>
					transaction
						.insert(s.userGroupMember)
						.values(
							group.memberUserIds.map((userId) => ({
								groupId: group.id,
								userId,
								provider: 'manual' as const,
							})),
						)
						.onConflictDoNothing(),
				),
			);
		}
	}
	operations.push(
		writeOperation((transaction) =>
			transaction
				.update(s.project)
				.set({ userGroupsConfigAppliedAt: now, updatedAt: now })
				.where(eq(s.project.id, plan.projectId)),
		),
		writeOperation((transaction) =>
			transaction.insert(s.activity).values({
				projectId: plan.projectId,
				userId: plan.actorUserId,
				type: 'user_group.config_applied',
				status: 'completed',
				trigger: plan.actorUserId ? 'manual' : 'system',
				payload: {
					hash: plan.hash,
					created: plan.groups.filter((group) => !group.existing).length,
					archived: plan.archivedGroups.length,
				},
				completedAt: now,
			}),
		),
	);
	return operations;
}

export async function setConfigMembershipsForUser(
	projectId: string,
	userId: string,
	groupIds: string[],
): Promise<void> {
	const configGroups = await db
		.select({ id: s.userGroup.id })
		.from(s.userGroup)
		.where(and(eq(s.userGroup.projectId, projectId), eq(s.userGroup.isDefault, false)))
		.execute();
	const configGroupIds = configGroups.map(({ id }) => id);
	if (configGroupIds.length === 0) {
		return;
	}
	const operations: DatabaseOperation[] = [
		writeOperation((transaction) =>
			transaction
				.delete(s.userGroupMember)
				.where(
					and(
						eq(s.userGroupMember.userId, userId),
						eq(s.userGroupMember.provider, 'manual'),
						inArray(s.userGroupMember.groupId, configGroupIds),
					),
				),
		),
	];
	if (groupIds.length > 0) {
		operations.push(
			writeOperation((transaction) =>
				transaction
					.insert(s.userGroupMember)
					.values(groupIds.map((groupId) => ({ groupId, userId, provider: 'manual' as const })))
					.onConflictDoNothing(),
			),
		);
	}
	await executeOperations(operations, projectId);
}

async function executeOperations(operations: DatabaseOperation[], projectId: string): Promise<void> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		db.transaction(
			(transaction) => {
				transaction.select({ id: s.project.id }).from(s.project).where(eq(s.project.id, projectId)).get();
				for (const operation of operations) {
					operation.sqlite(transaction);
				}
			},
			{ behavior: 'immediate' },
		);
		return;
	}
	await db.transaction(async (transaction) => {
		const lockQuery = transaction
			.select({ id: s.project.id })
			.from(s.project)
			.where(eq(s.project.id, projectId))
			.limit(1);
		await (lockQuery as typeof lockQuery & { for(strength: 'update'): typeof lockQuery }).for('update').execute();
		for (const operation of operations) {
			await operation.postgres(transaction);
		}
	});
}

function writeOperation(
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

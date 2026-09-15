import {
	type DatabaseContextAccess,
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	type DocsContextAccess,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	EMPTY_USER_GROUP_ROW_POLICIES,
	filterUserGroupRowPoliciesByDatabaseContext,
	parseStoredProjectRowSecurity,
	parseStoredUserGroupConfig,
	parseStoredUserGroupContextAccess,
	parseStoredUserGroupRowPolicies,
	parseStoredUserGroupSsoMappings,
	type ProjectRowSecurity,
	serializeProjectRowSecurity,
	serializeUserGroupConfig,
	serializeUserGroupContextAccess,
	serializeUserGroupRowPolicies,
	serializeUserGroupSsoMappings,
	type SsoGroupProvider,
	type StoredProjectRowSecurity,
	type ToolCallDensityPolicy,
	unionDatabaseContextAccess,
	unionDocsContextAccess,
	USER_GROUP_FEATURES,
	type UserGroupFeature,
	type UserGroupRowPolicies,
	type UserGroupSsoMappings,
} from '@nao/shared';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';

import type { DBUserGroup, NewUserGroup } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db, type DBExecutor, type DBTransaction } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import {
	listUsersWithProjectAccess,
	listUsersWithProjectAccessDetails,
	type UserWithProjectAccessDetails,
} from './project.queries';

const USER_GROUP_NAME_CONFLICT_MESSAGE = 'A user group with this name already exists.';
const USER_GROUP_NAME_UNIQUE_CONSTRAINT = 'user_group_project_name_unique';

export interface UserGroup extends Omit<
	DBUserGroup,
	'contextGrants' | 'featureGrants' | 'rowPolicies' | 'ssoMappings'
> {
	featureGrants: UserGroupFeature[];
	toolCallDensityPolicy: ToolCallDensityPolicy;
	databaseAccess: DatabaseContextAccess;
	docsAccess: DocsContextAccess;
	ssoMappings: UserGroupSsoMappings;
	rowPolicies: UserGroupRowPolicies;
}

export interface UserGroupOverview {
	users: UserWithProjectAccessDetails[];
	groups: UserGroup[];
	memberships: Array<{ groupId: string; userId: string }>;
	ssoMemberships: Array<{ groupId: string; userId: string; provider: string }>;
}

export interface EffectiveUserGroupAccess {
	groupNames: string[];
	features: UserGroupFeature[];
	toolCallDensityPolicy: ToolCallDensityPolicy;
	databaseAccess: DatabaseContextAccess;
	docsAccess: DocsContextAccess;
	rowPolicies: UserGroupRowPolicies[];
}

export class UserGroupQueryError extends Error {
	constructor(
		public readonly code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN',
		message: string,
	) {
		super(message);
	}
}

export const getUserGroupOverview = async (projectId: string): Promise<UserGroupOverview> => {
	const [users, groups, manualMemberships, ssoMemberships] = await Promise.all([
		listUsersWithProjectAccessDetails(projectId),
		listUserGroups(projectId),
		listUserGroupMemberships(projectId),
		listUserGroupSsoMemberships(projectId),
	]);
	const defaultGroup = groups.find((group) => group.isDefault);
	const defaultMemberships = defaultGroup ? users.map((user) => ({ groupId: defaultGroup.id, userId: user.id })) : [];
	const effectiveUserIds = new Set(users.map((user) => user.id));
	const effectiveMemberships = deduplicateMemberships([
		...defaultMemberships,
		...manualMemberships,
		...ssoMemberships,
	]).filter(({ userId }) => effectiveUserIds.has(userId));

	return {
		users,
		groups,
		memberships: effectiveMemberships,
		ssoMemberships: ssoMemberships.filter(({ userId }) => effectiveUserIds.has(userId)),
	};
};

export const resolveEffectiveUserGroupAccess = async (
	projectId: string,
	userId: string,
	activeGroupIds?: ReadonlySet<string>,
): Promise<EffectiveUserGroupAccess> => {
	const [groups, manualMemberships, ssoMemberships] = await Promise.all([
		db.select().from(s.userGroup).where(eq(s.userGroup.projectId, projectId)).execute(),
		db
			.select({ groupId: s.userGroupMember.groupId, createdAt: s.userGroupMember.createdAt })
			.from(s.userGroupMember)
			.innerJoin(s.userGroup, eq(s.userGroup.id, s.userGroupMember.groupId))
			.where(and(eq(s.userGroup.projectId, projectId), eq(s.userGroupMember.userId, userId)))
			.execute(),
		db
			.select({ groupId: s.userGroupSsoMember.groupId, createdAt: s.userGroupSsoMember.createdAt })
			.from(s.userGroupSsoMember)
			.innerJoin(s.userGroup, eq(s.userGroup.id, s.userGroupSsoMember.groupId))
			.where(and(eq(s.userGroup.projectId, projectId), eq(s.userGroupSsoMember.userId, userId)))
			.execute(),
	]);
	const membershipDates = new Map<string, Date>();
	for (const membership of [...manualMemberships, ...ssoMemberships]) {
		const current = membershipDates.get(membership.groupId);
		if (!current || membership.createdAt > current) {
			membershipDates.set(membership.groupId, membership.createdAt);
		}
	}
	const applicableGroups = groups
		.filter(
			(group) =>
				(activeGroupIds === undefined || activeGroupIds.has(group.id)) &&
				(group.isDefault || membershipDates.has(group.id)),
		)
		.map((group) => ({
			...group,
			membershipCreatedAt: membershipDates.get(group.id) ?? null,
			config: parseStoredUserGroupConfig(group.featureGrants),
			contextAccess: parseStoredUserGroupContextAccess(group.contextGrants, group.isDefault),
		}));
	const grantedFeatures = new Set(applicableGroups.flatMap((group) => group.config.features));
	const defaultGroup = applicableGroups.find((group) => group.isDefault);
	const newestExplicitGroup = applicableGroups
		.filter(
			(
				group,
			): group is typeof group & {
				membershipCreatedAt: Date;
			} => !group.isDefault && group.membershipCreatedAt !== null,
		)
		.sort(
			(left, right) =>
				right.membershipCreatedAt.getTime() - left.membershipCreatedAt.getTime() ||
				left.id.localeCompare(right.id),
		)[0];
	const densitySource = newestExplicitGroup ?? defaultGroup;

	return {
		groupNames: applicableGroups.map((group) => group.name),
		features: USER_GROUP_FEATURES.filter((feature) => grantedFeatures.has(feature)),
		toolCallDensityPolicy: {
			defaultDensity:
				densitySource?.config.toolCallDensity.defaultDensity ?? DEFAULT_TOOL_CALL_DENSITY_POLICY.defaultDensity,
			canChange: applicableGroups.some((group) => group.config.toolCallDensity.canChange),
		},
		databaseAccess: unionDatabaseContextAccess(applicableGroups.map((group) => group.contextAccess.databaseAccess)),
		docsAccess: unionDocsContextAccess(applicableGroups.map((group) => group.contextAccess.docsAccess)),
		rowPolicies: applicableGroups.map((group) =>
			filterUserGroupRowPoliciesByDatabaseContext(
				parseStoredUserGroupRowPolicies(group.rowPolicies),
				group.contextAccess.databaseAccess,
			),
		),
	};
};

export const getProjectRowSecurity = async (projectId: string): Promise<ProjectRowSecurity> => {
	const [project] = await db
		.select({ rowSecurity: s.project.rowSecurity })
		.from(s.project)
		.where(eq(s.project.id, projectId))
		.limit(1)
		.execute();
	if (!project) {
		throw new UserGroupQueryError('NOT_FOUND', 'Project not found.');
	}
	return parseStoredProjectRowSecurity(project.rowSecurity);
};

export const updateProjectRowSecurity = async (
	projectId: string,
	rowSecurity: ProjectRowSecurity,
): Promise<ProjectRowSecurity> => {
	const normalized = serializeProjectRowSecurity(rowSecurity);
	if (dbConfig.dialect === Dialect.Postgres) {
		await db.transaction((transaction) => updatePostgresProjectRowSecurity(transaction, projectId, normalized));
	} else {
		db.transaction((transaction) => updateSqliteProjectRowSecurity(transaction, projectId, normalized));
	}
	return normalized;
};

export const listUserGroups = async (projectId: string): Promise<UserGroup[]> =>
	db
		.select()
		.from(s.userGroup)
		.where(eq(s.userGroup.projectId, projectId))
		.orderBy(desc(s.userGroup.isDefault), asc(s.userGroup.name))
		.execute()
		.then((groups) => groups.map(normalizeUserGroup));

export const countCustomUserGroups = async (projectId: string): Promise<number> => {
	const [result] = await db
		.select({ count: count() })
		.from(s.userGroup)
		.where(and(eq(s.userGroup.projectId, projectId), eq(s.userGroup.isDefault, false)))
		.execute();
	return result?.count ?? 0;
};

export const createUserGroup = async (
	projectId: string,
	name: string,
	featureGrants: UserGroupFeature[] = [],
	toolCallDensityPolicy: ToolCallDensityPolicy = DEFAULT_TOOL_CALL_DENSITY_POLICY,
	databaseAccess: DatabaseContextAccess = EMPTY_DATABASE_CONTEXT_ACCESS,
	docsAccess: DocsContextAccess = EMPTY_DOCS_CONTEXT_ACCESS,
	ssoMappings?: UserGroupSsoMappings,
	rowPolicies: UserGroupRowPolicies = EMPTY_USER_GROUP_ROW_POLICIES,
): Promise<UserGroup> => {
	const values = createUserGroupValues(
		projectId,
		name,
		featureGrants,
		toolCallDensityPolicy,
		databaseAccess,
		docsAccess,
		ssoMappings,
		rowPolicies,
	);
	const group = await executeUserGroupNameMutation(async () => {
		if (dbConfig.dialect === Dialect.Sqlite) {
			return db.transaction(
				(transaction) => {
					assertNameAvailableSqlite(transaction, projectId, name);
					return transaction.insert(s.userGroup).values(values).returning().get();
				},
				{ behavior: 'immediate' },
			);
		}

		return db.transaction(async (transaction) => {
			await lockProjectForUserGroupMutation(transaction, projectId);
			await assertNameAvailable(transaction, projectId, name);
			const [created] = await transaction.insert(s.userGroup).values(values).returning().execute();
			return created;
		});
	});
	return normalizeUserGroup(group);
};

export const createUserGroupWithinLimit = async (
	limit: number,
	projectId: string,
	name: string,
	featureGrants: UserGroupFeature[] = [],
	toolCallDensityPolicy: ToolCallDensityPolicy = DEFAULT_TOOL_CALL_DENSITY_POLICY,
	databaseAccess: DatabaseContextAccess = EMPTY_DATABASE_CONTEXT_ACCESS,
	docsAccess: DocsContextAccess = EMPTY_DOCS_CONTEXT_ACCESS,
	ssoMappings?: UserGroupSsoMappings,
	rowPolicies: UserGroupRowPolicies = EMPTY_USER_GROUP_ROW_POLICIES,
): Promise<UserGroup> => {
	const values = createUserGroupValues(
		projectId,
		name,
		featureGrants,
		toolCallDensityPolicy,
		databaseAccess,
		docsAccess,
		ssoMappings,
		rowPolicies,
	);
	const group = await executeUserGroupNameMutation(() => {
		if (dbConfig.dialect === Dialect.Sqlite) {
			return db.transaction(
				(transaction) => {
					assertNameAvailableSqlite(transaction, projectId, name);
					const [{ count: existingCount }] = transaction
						.select({ count: count() })
						.from(s.userGroup)
						.where(and(eq(s.userGroup.projectId, projectId), eq(s.userGroup.isDefault, false)))
						.all();
					assertCustomUserGroupLimit(existingCount, limit);
					return transaction.insert(s.userGroup).values(values).returning().get();
				},
				{ behavior: 'immediate' },
			);
		}

		return db.transaction(async (transaction) => {
			await lockProjectForUserGroupMutation(transaction, projectId);
			await assertNameAvailable(transaction, projectId, name);
			const [{ count: existingCount }] = await transaction
				.select({ count: count() })
				.from(s.userGroup)
				.where(and(eq(s.userGroup.projectId, projectId), eq(s.userGroup.isDefault, false)))
				.execute();
			assertCustomUserGroupLimit(existingCount, limit);
			const [created] = await transaction.insert(s.userGroup).values(values).returning().execute();
			return created;
		});
	});
	return normalizeUserGroup(group);
};

export const updateUserGroup = async (
	projectId: string,
	groupId: string,
	data: {
		name?: string;
		featureGrants: UserGroupFeature[];
		toolCallDensityPolicy?: ToolCallDensityPolicy;
		databaseAccess?: DatabaseContextAccess;
		docsAccess?: DocsContextAccess;
		ssoMappings?: UserGroupSsoMappings;
		rowPolicies?: UserGroupRowPolicies;
		rowPoliciesRegistry?: ProjectRowSecurity;
	},
): Promise<UserGroup> => {
	const group = await getUserGroup(projectId, groupId);
	const rowPoliciesRegistry =
		dbConfig.dialect === Dialect.Postgres && data.rowPolicies !== undefined
			? (data.rowPoliciesRegistry ?? (await getProjectRowSecurity(projectId)))
			: undefined;
	const currentConfig = parseStoredUserGroupConfig(group.featureGrants);
	const currentContext = parseStoredUserGroupContextAccess(group.contextGrants, group.isDefault);
	const resultingDatabaseAccess = data.databaseAccess ?? currentContext.databaseAccess;
	const resultingRowPolicies = filterUserGroupRowPoliciesByDatabaseContext(
		data.rowPolicies ?? parseStoredUserGroupRowPolicies(group.rowPolicies),
		resultingDatabaseAccess,
	);
	if (group.isDefault && data.name !== undefined && data.name !== group.name) {
		throw new UserGroupQueryError('BAD_REQUEST', 'The All Users group cannot be renamed.');
	}
	if (
		group.isDefault &&
		data.ssoMappings !== undefined &&
		Object.values(serializeUserGroupSsoMappings(data.ssoMappings).providers).some(
			(identifiers) => identifiers.length > 0,
		)
	) {
		throw new UserGroupQueryError('BAD_REQUEST', 'The All Users group cannot be mapped to SSO groups.');
	}
	const serializedSsoMappings =
		data.ssoMappings === undefined ? undefined : serializeUserGroupSsoMappings(data.ssoMappings);
	const changedProviders =
		serializedSsoMappings === undefined ? [] : getChangedSsoProviders(group.ssoMappings, serializedSsoMappings);
	const updateValues = {
		...(data.name === undefined ? {} : { name: data.name }),
		featureGrants: serializeUserGroupConfig(
			data.featureGrants,
			data.toolCallDensityPolicy ?? currentConfig.toolCallDensity,
		),
		...(data.databaseAccess === undefined && data.docsAccess === undefined
			? {}
			: {
					contextGrants: serializeUserGroupContextAccess(
						data.databaseAccess ?? currentContext.databaseAccess,
						data.docsAccess ?? currentContext.docsAccess,
					),
				}),
		...(serializedSsoMappings === undefined ? {} : { ssoMappings: serializedSsoMappings }),
		rowPolicies: serializeUserGroupRowPolicies(resultingRowPolicies),
		updatedAt: new Date(),
	};
	const updated = await executeUserGroupNameMutation(() => {
		if (dbConfig.dialect === Dialect.Sqlite) {
			return db.transaction(
				(transaction) => {
					if (data.name !== undefined && data.name !== group.name) {
						assertNameAvailableSqlite(transaction, projectId, data.name, groupId);
					}
					const stored = transaction
						.update(s.userGroup)
						.set(updateValues)
						.where(and(eq(s.userGroup.id, groupId), eq(s.userGroup.projectId, projectId)))
						.returning()
						.get();
					deleteChangedSsoMembershipsSqlite(transaction, groupId, changedProviders);
					return stored;
				},
				{ behavior: 'immediate' },
			);
		}

		return db.transaction(async (transaction) => {
			const currentRegistry = await lockProjectRowSecurityForUserGroupUpdate(transaction, projectId);
			if (rowPoliciesRegistry !== undefined) {
				assertRowPoliciesRegistryCurrent(rowPoliciesRegistry, currentRegistry);
			}
			const lockedGroup = await getUserGroup(projectId, groupId, transaction);
			const lockedContext = parseStoredUserGroupContextAccess(lockedGroup.contextGrants, lockedGroup.isDefault);
			const lockedDatabaseAccess = data.databaseAccess ?? lockedContext.databaseAccess;
			const lockedRowPolicies = filterUserGroupRowPoliciesByDatabaseContext(
				data.rowPolicies ?? parseStoredUserGroupRowPolicies(lockedGroup.rowPolicies),
				lockedDatabaseAccess,
			);
			if (data.name !== undefined && data.name !== lockedGroup.name) {
				await assertNameAvailable(transaction, projectId, data.name, groupId);
			}
			const [stored] = await transaction
				.update(s.userGroup)
				.set({
					...updateValues,
					rowPolicies: serializeUserGroupRowPolicies(lockedRowPolicies),
				})
				.where(and(eq(s.userGroup.id, groupId), eq(s.userGroup.projectId, projectId)))
				.returning()
				.execute();
			const lockedChangedProviders =
				serializedSsoMappings === undefined
					? []
					: getChangedSsoProviders(lockedGroup.ssoMappings, serializedSsoMappings);
			await deleteChangedSsoMembershipsPostgres(transaction, groupId, lockedChangedProviders);
			return stored;
		});
	});
	return normalizeUserGroup(updated);
};

export const deleteUserGroup = async (projectId: string, groupId: string): Promise<void> => {
	const group = await getUserGroup(projectId, groupId);
	if (group.isDefault) {
		throw new UserGroupQueryError('BAD_REQUEST', 'The All Users group cannot be deleted.');
	}
	await db
		.delete(s.userGroup)
		.where(and(eq(s.userGroup.id, groupId), eq(s.userGroup.projectId, projectId)))
		.execute();
};

export const listUserGroupMemberships = async (
	projectId: string,
): Promise<Array<{ groupId: string; userId: string }>> =>
	db
		.select({
			groupId: s.userGroupMember.groupId,
			userId: s.userGroupMember.userId,
		})
		.from(s.userGroupMember)
		.innerJoin(s.userGroup, eq(s.userGroup.id, s.userGroupMember.groupId))
		.where(eq(s.userGroup.projectId, projectId))
		.execute();

export const listUserGroupSsoMemberships = async (
	projectId: string,
): Promise<Array<{ groupId: string; userId: string; provider: string }>> =>
	db
		.select({
			groupId: s.userGroupSsoMember.groupId,
			userId: s.userGroupSsoMember.userId,
			provider: s.userGroupSsoMember.provider,
		})
		.from(s.userGroupSsoMember)
		.innerJoin(s.userGroup, eq(s.userGroup.id, s.userGroupSsoMember.groupId))
		.where(eq(s.userGroup.projectId, projectId))
		.execute();

export const validateAssignableUserGroupIds = async (projectId: string, groupIds: string[]): Promise<string[]> => {
	const uniqueGroupIds = [...new Set(groupIds)];
	if (uniqueGroupIds.length === 0) {
		return [];
	}

	const groups = await db
		.select({ id: s.userGroup.id, isDefault: s.userGroup.isDefault })
		.from(s.userGroup)
		.where(and(eq(s.userGroup.projectId, projectId), inArray(s.userGroup.id, uniqueGroupIds)))
		.execute();
	const groupsById = new Map(groups.map((group) => [group.id, group]));
	if (uniqueGroupIds.some((groupId) => !groupsById.has(groupId) || groupsById.get(groupId)?.isDefault)) {
		throw new UserGroupQueryError('BAD_REQUEST', 'One or more user groups cannot be assigned to this user.');
	}

	return uniqueGroupIds;
};

export const addUserGroupMemberships = async (
	groupIds: string[],
	userId: string,
	executor: DBExecutor = db,
): Promise<void> => {
	const uniqueGroupIds = [...new Set(groupIds)];
	if (uniqueGroupIds.length === 0) {
		return;
	}
	await executor
		.insert(s.userGroupMember)
		.values(uniqueGroupIds.map((groupId) => ({ groupId, userId })))
		.onConflictDoNothing()
		.execute();
};

export const setUserGroupMembership = async (
	projectId: string,
	groupId: string,
	userId: string,
	isMember: boolean,
): Promise<void> => {
	const group = await getUserGroup(projectId, groupId);
	if (group.isDefault) {
		throw new UserGroupQueryError('BAD_REQUEST', 'Membership in All Users cannot be changed.');
	}
	const effectiveUsers = await listUsersWithProjectAccess(projectId);
	if (!effectiveUsers.some((user) => user.id === userId)) {
		throw new UserGroupQueryError('BAD_REQUEST', 'This user does not have access to the project.');
	}

	if (isMember) {
		await db.insert(s.userGroupMember).values({ groupId, userId }).onConflictDoNothing().execute();
		return;
	}
	await db
		.delete(s.userGroupMember)
		.where(and(eq(s.userGroupMember.groupId, groupId), eq(s.userGroupMember.userId, userId)))
		.execute();
};

const getUserGroup = async (projectId: string, groupId: string, executor: DBExecutor = db): Promise<DBUserGroup> => {
	const [group] = await executor
		.select()
		.from(s.userGroup)
		.where(and(eq(s.userGroup.id, groupId), eq(s.userGroup.projectId, projectId)))
		.limit(1)
		.execute();
	if (!group) {
		throw new UserGroupQueryError('NOT_FOUND', 'User group not found.');
	}
	return group;
};

const assertNameAvailable = async (
	executor: DBExecutor,
	projectId: string,
	name: string,
	excludedGroupId?: string,
): Promise<void> => {
	const groups = await executor
		.select({ id: s.userGroup.id, name: s.userGroup.name })
		.from(s.userGroup)
		.where(eq(s.userGroup.projectId, projectId))
		.execute();
	assertNameAvailableInGroups(groups, name, excludedGroupId);
};

function assertNameAvailableSqlite(
	transaction: DBTransaction,
	projectId: string,
	name: string,
	excludedGroupId?: string,
): void {
	const groups = transaction
		.select({ id: s.userGroup.id, name: s.userGroup.name })
		.from(s.userGroup)
		.where(eq(s.userGroup.projectId, projectId))
		.all();
	assertNameAvailableInGroups(groups, name, excludedGroupId);
}

function assertNameAvailableInGroups(
	groups: Array<{ id: string; name: string }>,
	name: string,
	excludedGroupId?: string,
): void {
	const normalizedName = name.toLowerCase();
	if (groups.some((group) => group.id !== excludedGroupId && group.name.toLowerCase() === normalizedName)) {
		throw new UserGroupQueryError('CONFLICT', USER_GROUP_NAME_CONFLICT_MESSAGE);
	}
}

function createUserGroupValues(
	projectId: string,
	name: string,
	featureGrants: UserGroupFeature[],
	toolCallDensityPolicy: ToolCallDensityPolicy,
	databaseAccess: DatabaseContextAccess,
	docsAccess: DocsContextAccess,
	ssoMappings?: UserGroupSsoMappings,
	rowPolicies: UserGroupRowPolicies = EMPTY_USER_GROUP_ROW_POLICIES,
): NewUserGroup {
	const filteredRowPolicies = filterUserGroupRowPoliciesByDatabaseContext(rowPolicies, databaseAccess);
	return {
		projectId,
		name,
		featureGrants: serializeUserGroupConfig(featureGrants, toolCallDensityPolicy),
		contextGrants: serializeUserGroupContextAccess(databaseAccess, docsAccess),
		ssoMappings: serializeUserGroupSsoMappings(ssoMappings),
		rowPolicies: serializeUserGroupRowPolicies(filteredRowPolicies),
		isDefault: false,
	};
}

function assertCustomUserGroupLimit(existingCount: number, limit: number): void {
	if (existingCount >= limit) {
		throw new UserGroupQueryError(
			'FORBIDDEN',
			`Free projects can create up to ${limit} custom user groups. Enterprise enables unlimited groups.`,
		);
	}
}

async function lockProjectForUserGroupMutation(transaction: DBTransaction, projectId: string): Promise<void> {
	const query = transaction.select({ id: s.project.id }).from(s.project).where(eq(s.project.id, projectId));
	await (query as typeof query & { for(strength: 'update'): typeof query }).for('update').execute();
}

async function lockProjectRowSecurityForUserGroupUpdate(
	transaction: DBTransaction,
	projectId: string,
): Promise<ProjectRowSecurity> {
	const query = transaction
		.select({ id: s.project.id, rowSecurity: s.project.rowSecurity })
		.from(s.project)
		.where(eq(s.project.id, projectId))
		.limit(1);
	const [project] = await (query as typeof query & { for(strength: 'update'): typeof query }).for('update').execute();
	assertProjectExists(project);
	return parseStoredProjectRowSecurity(project.rowSecurity);
}

function assertRowPoliciesRegistryCurrent(expected: ProjectRowSecurity, current: ProjectRowSecurity): void {
	if (JSON.stringify(serializeProjectRowSecurity(expected)) !== JSON.stringify(current)) {
		throw new UserGroupQueryError(
			'CONFLICT',
			'Project row security changed while this user group was being updated. Review the current registry and try again.',
		);
	}
}

function getChangedSsoProviders(
	currentMappings: DBUserGroup['ssoMappings'],
	nextMappings: ReturnType<typeof serializeUserGroupSsoMappings>,
): SsoGroupProvider[] {
	const current = parseStoredUserGroupSsoMappings(currentMappings).providers;
	return (['oidc', 'microsoft'] as const).filter(
		(provider) => !haveSameIdentifiers(current[provider], nextMappings.providers[provider]),
	);
}

function haveSameIdentifiers(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((identifier) => right.includes(identifier));
}

function deleteChangedSsoMembershipsSqlite(
	transaction: DBTransaction,
	groupId: string,
	providers: SsoGroupProvider[],
): void {
	if (providers.length === 0) {
		return;
	}
	transaction
		.delete(s.userGroupSsoMember)
		.where(and(eq(s.userGroupSsoMember.groupId, groupId), inArray(s.userGroupSsoMember.provider, providers)))
		.run();
}

async function deleteChangedSsoMembershipsPostgres(
	transaction: DBTransaction,
	groupId: string,
	providers: SsoGroupProvider[],
): Promise<void> {
	if (providers.length === 0) {
		return;
	}
	await transaction
		.delete(s.userGroupSsoMember)
		.where(and(eq(s.userGroupSsoMember.groupId, groupId), inArray(s.userGroupSsoMember.provider, providers)))
		.execute();
}

const executeUserGroupNameMutation = async <T>(operation: () => Promise<T> | T): Promise<T> => {
	try {
		return await operation();
	} catch (error) {
		if (isUserGroupNameUniqueViolation(error)) {
			throw new UserGroupQueryError('CONFLICT', USER_GROUP_NAME_CONFLICT_MESSAGE);
		}
		throw error;
	}
};

function isUserGroupNameUniqueViolation(error: unknown): boolean {
	const databaseError = error instanceof Error && error.cause ? error.cause : error;
	if (!databaseError || typeof databaseError !== 'object') {
		return false;
	}
	const { code, constraint_name: constraintName, errno, message } = databaseError as Record<string, unknown>;
	return (
		(code === '23505' &&
			typeof constraintName === 'string' &&
			constraintName === USER_GROUP_NAME_UNIQUE_CONSTRAINT) ||
		((code === 'SQLITE_CONSTRAINT_UNIQUE' || errno === 2067) &&
			typeof message === 'string' &&
			message.includes('UNIQUE constraint failed: user_group.project_id, user_group.name'))
	);
}

function normalizeUserGroup(group: DBUserGroup): UserGroup {
	const config = parseStoredUserGroupConfig(group.featureGrants);
	const contextAccess = parseStoredUserGroupContextAccess(group.contextGrants, group.isDefault);
	return {
		id: group.id,
		projectId: group.projectId,
		name: group.name,
		isDefault: group.isDefault,
		createdAt: group.createdAt,
		updatedAt: group.updatedAt,
		featureGrants: config.features,
		toolCallDensityPolicy: config.toolCallDensity,
		databaseAccess: contextAccess.databaseAccess,
		docsAccess: contextAccess.docsAccess,
		ssoMappings: parseStoredUserGroupSsoMappings(group.ssoMappings),
		rowPolicies: parseStoredUserGroupRowPolicies(group.rowPolicies),
	};
}

function rowSecurityIdentityKey(identity: {
	databaseType: string;
	database: string;
	schema: string;
	table: string;
}): string {
	return [identity.databaseType, identity.database, identity.schema, identity.table].join('\0');
}

async function updatePostgresProjectRowSecurity(
	transaction: DBTransaction,
	projectId: string,
	rowSecurity: ProjectRowSecurity,
): Promise<void> {
	const projectQuery = transaction
		.select({ id: s.project.id, rowSecurity: s.project.rowSecurity })
		.from(s.project)
		.where(eq(s.project.id, projectId))
		.limit(1);
	const [project] = await (projectQuery as typeof projectQuery & { for(strength: 'update'): typeof projectQuery })
		.for('update')
		.execute();
	assertProjectExists(project);
	const groups = await transaction
		.select({ id: s.userGroup.id, rowPolicies: s.userGroup.rowPolicies })
		.from(s.userGroup)
		.where(eq(s.userGroup.projectId, projectId))
		.execute();
	for (const group of groups) {
		const rowPolicies = pruneInvalidRowPolicies(group.rowPolicies, project.rowSecurity, rowSecurity);
		if (rowPolicies) {
			await transaction
				.update(s.userGroup)
				.set({ rowPolicies, updatedAt: new Date() })
				.where(eq(s.userGroup.id, group.id))
				.execute();
		}
	}
	await transaction
		.update(s.project)
		.set({ rowSecurity, updatedAt: new Date() })
		.where(eq(s.project.id, projectId))
		.execute();
}

function updateSqliteProjectRowSecurity(
	transaction: DBExecutor,
	projectId: string,
	rowSecurity: ProjectRowSecurity,
): void {
	const [project] = transaction
		.select({ id: s.project.id, rowSecurity: s.project.rowSecurity })
		.from(s.project)
		.where(eq(s.project.id, projectId))
		.limit(1)
		.all();
	assertProjectExists(project);
	const groups = transaction
		.select({ id: s.userGroup.id, rowPolicies: s.userGroup.rowPolicies })
		.from(s.userGroup)
		.where(eq(s.userGroup.projectId, projectId))
		.all();
	for (const group of groups) {
		const rowPolicies = pruneInvalidRowPolicies(group.rowPolicies, project.rowSecurity, rowSecurity);
		if (rowPolicies) {
			transaction
				.update(s.userGroup)
				.set({ rowPolicies, updatedAt: new Date() })
				.where(eq(s.userGroup.id, group.id))
				.run();
		}
	}
	transaction.update(s.project).set({ rowSecurity, updatedAt: new Date() }).where(eq(s.project.id, projectId)).run();
}

function pruneInvalidRowPolicies(
	storedPolicies: DBUserGroup['rowPolicies'],
	storedProjectRowSecurity: StoredProjectRowSecurity,
	rowSecurity: ProjectRowSecurity,
): UserGroupRowPolicies | null {
	const current = parseStoredUserGroupRowPolicies(storedPolicies);
	const previousTables = new Map(
		parseStoredProjectRowSecurity(storedProjectRowSecurity).tables.map((table) => [
			rowSecurityIdentityKey(table),
			table.constraintColumns,
		]),
	);
	const registeredTables = new Map(
		rowSecurity.tables.map((table) => [rowSecurityIdentityKey(table), table.constraintColumns]),
	);
	const policies = current.policies.filter((policy) => {
		const key = rowSecurityIdentityKey(policy);
		const constraintColumns = registeredTables.get(key);
		if (!constraintColumns) {
			return false;
		}
		const previousConstraintColumns = previousTables.get(key);
		const removedConstraintColumn =
			previousConstraintColumns === undefined ||
			previousConstraintColumns.some((column) => !constraintColumns.includes(column));
		if (policy.access === 'full' || !removedConstraintColumn) {
			return true;
		}
		return policy.mode === 'guided' && policy.conditions.every(({ column }) => constraintColumns.includes(column));
	});
	return policies.length === current.policies.length ? null : serializeUserGroupRowPolicies({ version: 1, policies });
}

function assertProjectExists(project: { id: string } | undefined): asserts project is { id: string } {
	if (!project) {
		throw new UserGroupQueryError('NOT_FOUND', 'Project not found.');
	}
}

function deduplicateMemberships(
	memberships: Array<{ groupId: string; userId: string }>,
): Array<{ groupId: string; userId: string }> {
	return [
		...new Map(memberships.map(({ groupId, userId }) => [`${groupId}:${userId}`, { groupId, userId }])).values(),
	];
}

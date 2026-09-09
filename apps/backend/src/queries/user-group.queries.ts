import {
	type DatabaseContextAccess,
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	type DocsContextAccess,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	parseStoredUserGroupConfig,
	parseStoredUserGroupContextAccess,
	parseStoredUserGroupSsoMappings,
	serializeUserGroupConfig,
	serializeUserGroupContextAccess,
	serializeUserGroupSsoMappings,
	type ToolCallDensityPolicy,
	unionDatabaseContextAccess,
	unionDocsContextAccess,
	USER_GROUP_FEATURES,
	type UserGroupFeature,
	type UserGroupSsoMappings,
} from '@nao/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { DBUserGroup } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import {
	listUsersWithProjectAccess,
	listUsersWithProjectAccessDetails,
	type UserWithProjectAccessDetails,
} from './project.queries';

const USER_GROUP_NAME_CONFLICT_MESSAGE = 'A user group with this name already exists.';
const USER_GROUP_NAME_UNIQUE_CONSTRAINT = 'user_group_project_name_unique';

export interface UserGroup extends Omit<DBUserGroup, 'contextGrants' | 'featureGrants' | 'ssoMappings'> {
	featureGrants: UserGroupFeature[];
	toolCallDensityPolicy: ToolCallDensityPolicy;
	databaseAccess: DatabaseContextAccess;
	docsAccess: DocsContextAccess;
	ssoMappings: UserGroupSsoMappings;
}

export interface UserGroupOverview {
	users: UserWithProjectAccessDetails[];
	groups: UserGroup[];
	memberships: Array<{ groupId: string; userId: string }>;
	ssoMemberships: Array<{ groupId: string; userId: string; provider: string }>;
}

export interface EffectiveUserGroupAccess {
	features: UserGroupFeature[];
	toolCallDensityPolicy: ToolCallDensityPolicy;
	databaseAccess: DatabaseContextAccess;
	docsAccess: DocsContextAccess;
}

export class UserGroupQueryError extends Error {
	constructor(
		public readonly code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT',
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
		.filter((group) => group.isDefault || membershipDates.has(group.id))
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
		features: USER_GROUP_FEATURES.filter((feature) => grantedFeatures.has(feature)),
		toolCallDensityPolicy: {
			defaultDensity:
				densitySource?.config.toolCallDensity.defaultDensity ?? DEFAULT_TOOL_CALL_DENSITY_POLICY.defaultDensity,
			canChange: applicableGroups.some((group) => group.config.toolCallDensity.canChange),
		},
		databaseAccess: unionDatabaseContextAccess(applicableGroups.map((group) => group.contextAccess.databaseAccess)),
		docsAccess: unionDocsContextAccess(applicableGroups.map((group) => group.contextAccess.docsAccess)),
	};
};

export const listUserGroups = async (projectId: string): Promise<UserGroup[]> =>
	db
		.select()
		.from(s.userGroup)
		.where(eq(s.userGroup.projectId, projectId))
		.orderBy(desc(s.userGroup.isDefault), asc(s.userGroup.name))
		.execute()
		.then((groups) => groups.map(normalizeUserGroup));

export const createUserGroup = async (
	projectId: string,
	name: string,
	featureGrants: UserGroupFeature[] = [],
	toolCallDensityPolicy: ToolCallDensityPolicy = DEFAULT_TOOL_CALL_DENSITY_POLICY,
	databaseAccess: DatabaseContextAccess = EMPTY_DATABASE_CONTEXT_ACCESS,
	docsAccess: DocsContextAccess = EMPTY_DOCS_CONTEXT_ACCESS,
	ssoMappings?: UserGroupSsoMappings,
): Promise<UserGroup> => {
	await assertNameAvailable(projectId, name);
	const [group] = await executeUserGroupNameMutation(() =>
		db
			.insert(s.userGroup)
			.values({
				projectId,
				name,
				featureGrants: serializeUserGroupConfig(featureGrants, toolCallDensityPolicy),
				contextGrants: serializeUserGroupContextAccess(databaseAccess, docsAccess),
				ssoMappings: serializeUserGroupSsoMappings(ssoMappings),
				isDefault: false,
			})
			.returning()
			.execute(),
	);
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
	},
): Promise<UserGroup> => {
	const group = await getUserGroup(projectId, groupId);
	const currentConfig = parseStoredUserGroupConfig(group.featureGrants);
	const currentContext = parseStoredUserGroupContextAccess(group.contextGrants, group.isDefault);
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
	if (data.name !== undefined && data.name !== group.name) {
		await assertNameAvailable(projectId, data.name, groupId);
	}
	const [updated] = await executeUserGroupNameMutation(() =>
		db
			.update(s.userGroup)
			.set({
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
				...(data.ssoMappings === undefined
					? {}
					: { ssoMappings: serializeUserGroupSsoMappings(data.ssoMappings) }),
				updatedAt: new Date(),
			})
			.where(and(eq(s.userGroup.id, groupId), eq(s.userGroup.projectId, projectId)))
			.returning()
			.execute(),
	);
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

const getUserGroup = async (projectId: string, groupId: string): Promise<DBUserGroup> => {
	const [group] = await db
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

const assertNameAvailable = async (projectId: string, name: string, excludedGroupId?: string): Promise<void> => {
	const groups = await db
		.select({ id: s.userGroup.id })
		.from(s.userGroup)
		.where(and(eq(s.userGroup.projectId, projectId), eq(s.userGroup.name, name)))
		.execute();
	if (groups.some((group) => group.id !== excludedGroupId)) {
		throw new UserGroupQueryError('CONFLICT', USER_GROUP_NAME_CONFLICT_MESSAGE);
	}
};

const executeUserGroupNameMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
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
		(code === '23505' && constraintName === USER_GROUP_NAME_UNIQUE_CONSTRAINT) ||
		((code === 'SQLITE_CONSTRAINT_UNIQUE' || errno === 2067) &&
			typeof message === 'string' &&
			message.includes('UNIQUE constraint failed: user_group.project_id, user_group.name'))
	);
}

function normalizeUserGroup(group: DBUserGroup): UserGroup {
	const config = parseStoredUserGroupConfig(group.featureGrants);
	const contextAccess = parseStoredUserGroupContextAccess(group.contextGrants, group.isDefault);
	return {
		...group,
		featureGrants: config.features,
		toolCallDensityPolicy: config.toolCallDensity,
		databaseAccess: contextAccess.databaseAccess,
		docsAccess: contextAccess.docsAccess,
		ssoMappings: parseStoredUserGroupSsoMappings(group.ssoMappings),
	};
}

function deduplicateMemberships(
	memberships: Array<{ groupId: string; userId: string }>,
): Array<{ groupId: string; userId: string }> {
	return [
		...new Map(memberships.map(({ groupId, userId }) => [`${groupId}:${userId}`, { groupId, userId }])).values(),
	];
}

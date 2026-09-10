import {
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	parseStoredUserGroupConfig,
	serializeUserGroupConfig,
	type ToolCallDensityPolicy,
	USER_GROUP_FEATURES,
	type UserGroupFeature,
} from '@nao/shared';
import { and, asc, desc, eq, isNotNull, or } from 'drizzle-orm';

import type { DBUserGroup } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import {
	listUsersWithProjectAccess,
	listUsersWithProjectAccessDetails,
	type UserWithProjectAccessDetails,
} from './project.queries';

const USER_GROUP_NAME_CONFLICT_MESSAGE = 'A user group with this name already exists.';
const USER_GROUP_NAME_UNIQUE_CONSTRAINT = 'user_group_project_name_unique';

export interface UserGroup extends Omit<DBUserGroup, 'featureGrants'> {
	featureGrants: UserGroupFeature[];
	toolCallDensityPolicy: ToolCallDensityPolicy;
}

export interface UserGroupOverview {
	users: UserWithProjectAccessDetails[];
	groups: UserGroup[];
	memberships: Array<{ groupId: string; userId: string }>;
}

export interface EffectiveUserGroupAccess {
	features: UserGroupFeature[];
	toolCallDensityPolicy: ToolCallDensityPolicy;
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
	const [users, groups, storedMemberships] = await Promise.all([
		listUsersWithProjectAccessDetails(projectId),
		listUserGroups(projectId),
		listUserGroupMemberships(projectId),
	]);
	const defaultGroup = groups.find((group) => group.isDefault);
	const defaultMemberships = defaultGroup ? users.map((user) => ({ groupId: defaultGroup.id, userId: user.id })) : [];
	const effectiveUserIds = new Set(users.map((user) => user.id));

	return {
		users,
		groups,
		memberships: [...defaultMemberships, ...storedMemberships.filter(({ userId }) => effectiveUserIds.has(userId))],
	};
};

export const resolveEffectiveUserGroupAccess = async (
	projectId: string,
	userId: string,
): Promise<EffectiveUserGroupAccess> => {
	const groups = await db
		.select({
			id: s.userGroup.id,
			isDefault: s.userGroup.isDefault,
			featureGrants: s.userGroup.featureGrants,
			membershipCreatedAt: s.userGroupMember.createdAt,
		})
		.from(s.userGroup)
		.leftJoin(
			s.userGroupMember,
			and(eq(s.userGroupMember.groupId, s.userGroup.id), eq(s.userGroupMember.userId, userId)),
		)
		.where(
			and(
				eq(s.userGroup.projectId, projectId),
				or(eq(s.userGroup.isDefault, true), isNotNull(s.userGroupMember.userId)),
			),
		)
		.execute();

	const applicableGroups = groups.map((group) => ({
		...group,
		config: parseStoredUserGroupConfig(group.featureGrants),
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
): Promise<UserGroup> => {
	await assertNameAvailable(projectId, name);
	const [group] = await executeUserGroupNameMutation(() =>
		db
			.insert(s.userGroup)
			.values({
				projectId,
				name,
				featureGrants: serializeUserGroupConfig(featureGrants, toolCallDensityPolicy),
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
	},
): Promise<UserGroup> => {
	const group = await getUserGroup(projectId, groupId);
	const currentConfig = parseStoredUserGroupConfig(group.featureGrants);
	if (group.isDefault && data.name !== undefined && data.name !== group.name) {
		throw new UserGroupQueryError('BAD_REQUEST', 'The All Users group cannot be renamed.');
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
	return {
		...group,
		featureGrants: config.features,
		toolCallDensityPolicy: config.toolCallDensity,
	};
}

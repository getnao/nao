import { and, eq, isNull } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import { CODE_MANAGED_USER_GROUPS_MESSAGE, UserGroupQueryError } from '../queries/user-group.queries';

export { CODE_MANAGED_USER_GROUPS_MESSAGE };

export async function getUserGroupManagementMode(projectId: string, executor: DBExecutor = db): Promise<'ui' | 'code'> {
	const [project] = await executor
		.select({ mode: s.project.userGroupManagementMode })
		.from(s.project)
		.where(eq(s.project.id, projectId))
		.limit(1)
		.execute();
	if (!project) {
		throw new UserGroupQueryError('NOT_FOUND', 'Project not found.');
	}
	return project.mode;
}

export async function assertUserGroupsUiManaged(projectId: string, executor: DBExecutor = db): Promise<void> {
	if ((await getUserGroupManagementMode(projectId, executor)) === 'code') {
		throw new UserGroupQueryError('FORBIDDEN', CODE_MANAGED_USER_GROUPS_MESSAGE);
	}
}

export async function listPendingUserGroupConfigAssignments(
	projectId: string,
): Promise<Array<{ groupId: string; email: string }>> {
	const [assignments, users] = await Promise.all([
		db
			.select({
				email: s.userGroupConfigMember.normalizedEmail,
				groupId: s.userGroupConfigMember.groupId,
			})
			.from(s.userGroupConfigMember)
			.innerJoin(s.userGroup, eq(s.userGroup.id, s.userGroupConfigMember.groupId))
			.where(
				and(
					eq(s.userGroup.projectId, projectId),
					eq(s.userGroupConfigMember.active, true),
					isNull(s.userGroup.archivedAt),
				),
			)
			.execute(),
		db
			.select({ email: s.user.email, groupId: s.userGroupMember.groupId })
			.from(s.userGroupMember)
			.innerJoin(s.user, eq(s.user.id, s.userGroupMember.userId))
			.innerJoin(s.userGroup, eq(s.userGroup.id, s.userGroupMember.groupId))
			.where(
				and(
					eq(s.userGroup.projectId, projectId),
					eq(s.userGroupMember.provider, 'config'),
					eq(s.userGroupMember.active, true),
				),
			)
			.execute(),
	]);
	const resolved = new Set(users.map((user) => `${user.groupId}\0${user.email.trim().toLowerCase()}`));
	return assignments
		.filter((assignment) => !resolved.has(`${assignment.groupId}\0${assignment.email}`))
		.sort((left, right) => left.email.localeCompare(right.email) || left.groupId.localeCompare(right.groupId));
}

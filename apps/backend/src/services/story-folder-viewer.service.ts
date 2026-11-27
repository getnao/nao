import type { UserRole } from '@nao/shared/types';

import * as projectQueries from '../queries/project.queries';
import type { FolderViewer } from '../queries/story-folder.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import { listLockedUserGroupIds } from './user-group-availability.service';

/** Locked groups grant nothing, so they do not open their team folders either. */
export async function getFolderViewer(
	projectId: string,
	userId: string,
	role?: UserRole | null,
): Promise<FolderViewer> {
	const [userRole, manualMemberships, ssoMemberships, lockedGroupIds] = await Promise.all([
		role === undefined ? projectQueries.getUserRoleInProject(projectId, userId) : role,
		userGroupQueries.listUserGroupMemberships(projectId),
		userGroupQueries.listUserGroupSsoMemberships(projectId),
		listLockedUserGroupIds(projectId),
	]);
	const lockedGroupIdSet = new Set(lockedGroupIds);
	const groupIds = new Set(
		[...manualMemberships, ...ssoMemberships]
			.filter((membership) => membership.userId === userId && !lockedGroupIdSet.has(membership.groupId))
			.map((membership) => membership.groupId),
	);
	return { userId, isAdmin: userRole === 'admin', isViewer: userRole === 'viewer', groupIds };
}

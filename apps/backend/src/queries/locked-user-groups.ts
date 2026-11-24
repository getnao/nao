/** The license decides which user groups are locked. */

export async function listLockedUserGroupIds(projectId: string): Promise<string[]> {
	const availability = await import('../services/user-group-availability.service');
	return availability.listLockedUserGroupIds(projectId);
}

export async function listLockedUserGroupIdsOfMember(userId: string): Promise<string[]> {
	const availability = await import('../services/user-group-availability.service');
	return availability.listLockedUserGroupIdsOfMember(userId);
}

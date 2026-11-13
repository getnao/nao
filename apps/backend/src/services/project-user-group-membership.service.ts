import type { DBProjectMember, NewProjectMember } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import * as projectQueries from '../queries/project.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import { assertUserGroupsUiManaged } from './user-group-management.service';

export async function addProjectMemberWithUserGroups(
	member: NewProjectMember,
	groupIds: string[],
): Promise<DBProjectMember> {
	await assertUserGroupsUiManaged(member.projectId);
	const uniqueGroupIds = [...new Set(groupIds)];
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction((transaction) => {
			const [createdMember] = transaction.insert(s.projectMember).values(member).returning().all();
			transaction
				.insert(s.userGroupMember)
				.values(
					uniqueGroupIds.map((groupId) => ({ groupId, userId: member.userId, provider: 'manual' as const })),
				)
				.onConflictDoUpdate({
					target: [s.userGroupMember.groupId, s.userGroupMember.userId, s.userGroupMember.provider],
					set: { active: true, createdAt: new Date() },
				})
				.run();
			return createdMember;
		});
	}

	return db.transaction(async (transaction) => {
		const createdMember = await projectQueries.addProjectMember(member, transaction);
		await userGroupQueries.addUserGroupMemberships(uniqueGroupIds, member.userId, transaction);
		return createdMember;
	});
}

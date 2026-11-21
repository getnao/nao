import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { isCloud } from '../env';

export const getImpersonatedGroupIds = async (projectId: string, userId: string): Promise<string[] | null> => {
	if (isCloud) {
		return null;
	}
	const [row] = await db
		.select({ groupIds: s.userGroupImpersonation.groupIds })
		.from(s.userGroupImpersonation)
		.where(and(eq(s.userGroupImpersonation.projectId, projectId), eq(s.userGroupImpersonation.userId, userId)))
		.limit(1)
		.execute();
	return row?.groupIds ?? null;
};

export const startGroupImpersonation = async (projectId: string, userId: string, groupIds: string[]): Promise<void> => {
	await db
		.insert(s.userGroupImpersonation)
		.values({ projectId, userId, groupIds })
		.onConflictDoUpdate({
			target: [s.userGroupImpersonation.userId, s.userGroupImpersonation.projectId],
			set: { groupIds, createdAt: new Date() },
		})
		.execute();
};

export const stopGroupImpersonation = async (projectId: string, userId: string): Promise<boolean> => {
	const deleted = await db
		.delete(s.userGroupImpersonation)
		.where(and(eq(s.userGroupImpersonation.projectId, projectId), eq(s.userGroupImpersonation.userId, userId)))
		.returning({ userId: s.userGroupImpersonation.userId })
		.execute();
	return deleted.length > 0;
};

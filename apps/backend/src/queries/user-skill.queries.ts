import { and, asc, eq } from 'drizzle-orm';

import s, { DBUserSkill, NewUserSkill } from '../db/abstractSchema';
import { db } from '../db/db';
import type { UserSkillShareStatus } from '../types/user-skill';

export type UserSkillWithAuthor = DBUserSkill & { authorName: string; authorEmail: string };

export const listUserSkills = async (projectId: string, userId: string): Promise<DBUserSkill[]> => {
	return db
		.select()
		.from(s.userSkill)
		.where(and(eq(s.userSkill.projectId, projectId), eq(s.userSkill.userId, userId)))
		.orderBy(asc(s.userSkill.name))
		.execute();
};

export const getUserSkill = async (projectId: string, userId: string, name: string): Promise<DBUserSkill | null> => {
	const [skill] = await db
		.select()
		.from(s.userSkill)
		.where(and(eq(s.userSkill.projectId, projectId), eq(s.userSkill.userId, userId), eq(s.userSkill.name, name)))
		.execute();
	return skill ?? null;
};

export const createUserSkill = async (skill: NewUserSkill): Promise<DBUserSkill> => {
	const [created] = await db.insert(s.userSkill).values(skill).returning().execute();
	return created;
};

export const updateUserSkill = async (
	projectId: string,
	userId: string,
	name: string,
	changes: Partial<Pick<NewUserSkill, 'description' | 'body' | 'shareStatus' | 'shareNote' | 'shareRequestedAt'>>,
): Promise<DBUserSkill | null> => {
	const [updated] = await db
		.update(s.userSkill)
		.set(changes)
		.where(and(eq(s.userSkill.projectId, projectId), eq(s.userSkill.userId, userId), eq(s.userSkill.name, name)))
		.returning()
		.execute();
	return updated ?? null;
};

export const deleteUserSkill = async (projectId: string, userId: string, name: string): Promise<void> => {
	await db
		.delete(s.userSkill)
		.where(and(eq(s.userSkill.projectId, projectId), eq(s.userSkill.userId, userId), eq(s.userSkill.name, name)))
		.execute();
};

export const listUserSkillsByShareStatus = async (
	projectId: string,
	shareStatus: UserSkillShareStatus,
): Promise<UserSkillWithAuthor[]> => {
	const rows = await db
		.select({ skill: s.userSkill, authorName: s.user.name, authorEmail: s.user.email })
		.from(s.userSkill)
		.innerJoin(s.user, eq(s.user.id, s.userSkill.userId))
		.where(and(eq(s.userSkill.projectId, projectId), eq(s.userSkill.shareStatus, shareStatus)))
		.orderBy(asc(s.userSkill.shareRequestedAt))
		.execute();
	return rows.map((row) => ({ ...row.skill, authorName: row.authorName, authorEmail: row.authorEmail }));
};

export const getUserSkillById = async (projectId: string, id: string): Promise<UserSkillWithAuthor | null> => {
	const [row] = await db
		.select({ skill: s.userSkill, authorName: s.user.name, authorEmail: s.user.email })
		.from(s.userSkill)
		.innerJoin(s.user, eq(s.user.id, s.userSkill.userId))
		.where(and(eq(s.userSkill.projectId, projectId), eq(s.userSkill.id, id)))
		.execute();
	return row ? { ...row.skill, authorName: row.authorName, authorEmail: row.authorEmail } : null;
};

export const setUserSkillShareStatus = async (
	projectId: string,
	id: string,
	shareStatus: UserSkillShareStatus,
): Promise<void> => {
	await db
		.update(s.userSkill)
		.set({ shareStatus })
		.where(and(eq(s.userSkill.projectId, projectId), eq(s.userSkill.id, id)))
		.execute();
};

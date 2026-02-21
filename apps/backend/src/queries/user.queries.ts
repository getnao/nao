import { count, eq } from 'drizzle-orm';

import s, { NewAccount, NewProjectMember, NewUser, User } from '../db/abstractSchema';
import { db } from '../db/db';
import { takeFirstOrThrow } from '../utils/queries';

export const get = async (identifier: { id: string } | { email: string }): Promise<User | null> => {
	const condition = 'id' in identifier ? eq(s.user.id, identifier.id) : eq(s.user.email, identifier.email);

	const [user] = await db.select().from(s.user).where(condition).execute();

	return user ?? null;
};

export const getName = async (userId: string): Promise<string | null> => {
	const [user] = await db.select({ name: s.user.name }).from(s.user).where(eq(s.user.id, userId)).execute();
	return user ? user.name : null;
};

export const modify = async (id: string, name: string): Promise<void> => {
	await db.update(s.user).set({ name }).where(eq(s.user.id, id)).execute();
};

export const getMemoryEnabled = async (userId: string): Promise<boolean> => {
	const user = await takeFirstOrThrow(
		db.select({ memoryEnabled: s.user.memoryEnabled }).from(s.user).where(eq(s.user.id, userId)).execute(),
	);

	return user.memoryEnabled;
};

export const setMemoryEnabled = async (userId: string, memoryEnabled: boolean): Promise<void> => {
	await db.update(s.user).set({ memoryEnabled }).where(eq(s.user.id, userId)).execute();
};

export const countAll = async (): Promise<number> => {
	const [result] = await db.select({ count: count() }).from(s.user).execute();
	return result?.count ?? 0;
};

export const getFirst = async (): Promise<User | null> => {
	const [user] = await db.select().from(s.user).limit(1).execute();
	return user ?? null;
};

export const create = async (user: NewUser, account: NewAccount, member: NewProjectMember): Promise<User> => {
	return await db.transaction(async (tx) => {
		const [created] = await tx.insert(s.user).values(user).returning().execute();
		await tx.insert(s.account).values(account).execute();
		member.userId = created.id;
		await tx.insert(s.projectMember).values(member).execute();
		return created;
	});
};

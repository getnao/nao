import { count, eq } from 'drizzle-orm';

import s, { User } from '../db/abstractSchema';
import { db } from '../db/db';

export const getUser = async (identifier: { id: string } | { email: string }): Promise<User | null> => {
	const condition = 'id' in identifier ? eq(s.user.id, identifier.id) : eq(s.user.email, identifier.email);

	const [user] = await db.select().from(s.user).where(condition).execute();

	return user ?? null;
};

export const modifyUser = async (id: string, data: { name?: string }): Promise<void> => {
	await db.update(s.user).set(data).where(eq(s.user.id, id)).execute();
};

export const countUsers = async (): Promise<number> => {
	const [result] = await db.select({ count: count() }).from(s.user).execute();
	return result?.count ?? 0;
};

export const getFirstUser = async (): Promise<User | null> => {
	const [user] = await db.select().from(s.user).limit(1).execute();
	return user ?? null;
};

import { eq } from 'drizzle-orm';

import s, { User } from '../db/abstractSchema';
import { db } from '../db/db';

export const getUser = async (identifier: { id: string } | { email: string }): Promise<User | null> => {
	const condition = 'id' in identifier ? eq(s.user.id, identifier.id) : eq(s.user.email, identifier.email);

	const [user] = await db.select().from(s.user).where(condition).execute();

	return user ?? null;
};

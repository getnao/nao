import { and, eq } from 'drizzle-orm';

import s, { NewAccount } from '../db/abstractSchema';
import { db } from '../db/db';

export const createAccount = async (account: NewAccount): Promise<void> => {
	await db.insert(s.account).values(account).returning().execute();
};

export const getUserAccount = async (userId: string): Promise<{ id: string; password: string | null } | null> => {
	const [account] = await db
		.select({ id: s.account.id, password: s.account.password })
		.from(s.account)
		.where(and(eq(s.account.userId, userId), eq(s.account.providerId, 'credential')))
		.execute();

	return account ?? null;
};

export const updateAccountPassword = async (accountId: string, hashedPassword: string): Promise<void> => {
	await db.update(s.account).set({ password: hashedPassword }).where(eq(s.account.id, accountId)).execute();
};

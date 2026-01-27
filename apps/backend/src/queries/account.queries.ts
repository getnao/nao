import { eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import * as userQueries from './user.queries';

export const getAccountById = async (userId: string): Promise<{ id: string; password: string | null } | null> => {
	const [account] = await db
		.select({ id: s.account.id, password: s.account.password })
		.from(s.account)
		.where(eq(s.account.userId, userId))
		.execute();

	return account ?? null;
};

export const updateAccountPassword = async (accountId: string, hashedPassword: string): Promise<void> => {
	await db.update(s.account).set({ password: hashedPassword }).where(eq(s.account.id, accountId)).execute();
};

export const updateAccountAndUser = async (
	accountId: string,
	hashedPassword: string,
	userId: string,
	name?: string,
): Promise<void> => {
	await updateAccountPassword(accountId, hashedPassword);
	if (name) {
		await userQueries.modify(userId, { name });
	}
};

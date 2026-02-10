import { eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export const getAccountById = async (userId: string): Promise<{ id: string; password: string | null } | null> => {
	const [account] = await db
		.select({ id: s.account.id, password: s.account.password })
		.from(s.account)
		.where(eq(s.account.userId, userId))
		.execute();

	return account ?? null;
};

export const updateAccountPassword = async (
	accountId: string,
	hashedPassword: string,
	userId: string,
	needToResetPassword = true,
): Promise<void> => {
	await db.transaction(async (tx) => {
		await tx.update(s.account).set({ password: hashedPassword }).where(eq(s.account.id, accountId)).execute();
		await tx
			.update(s.user)
			.set({ requiresPasswordReset: needToResetPassword })
			.where(eq(s.user.id, userId))
			.execute();
	});
};

import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

const CREDENTIAL_PROVIDER_ID = 'credential';

export const getAccountById = async (userId: string): Promise<{ id: string; password: string | null } | null> => {
	const [account] = await db
		.select({ id: s.account.id, password: s.account.password })
		.from(s.account)
		.where(and(eq(s.account.userId, userId), eq(s.account.providerId, CREDENTIAL_PROVIDER_ID)))
		.execute();

	return account ?? null;
};

export const getIdToken = async (userId: string, providerId: string): Promise<string | null> => {
	const [account] = await db
		.select({ idToken: s.account.idToken })
		.from(s.account)
		.where(and(eq(s.account.userId, userId), eq(s.account.providerId, providerId)))
		.limit(1)
		.execute();

	return account?.idToken ?? null;
};

export const hasAccountForProvider = async (userId: string, providerId: string): Promise<boolean> => {
	const [account] = await db
		.select({ id: s.account.id })
		.from(s.account)
		.where(and(eq(s.account.userId, userId), eq(s.account.providerId, providerId)))
		.limit(1)
		.execute();

	return !!account;
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

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

export const getUserIdByProviderAccount = async (providerId: string, accountId: string): Promise<string | null> => {
	const [account] = await db
		.select({ userId: s.account.userId })
		.from(s.account)
		.where(and(eq(s.account.providerId, providerId), eq(s.account.accountId, accountId)))
		.limit(1)
		.execute();

	return account?.userId ?? null;
};

export const linkProviderAccount = async (data: {
	providerId: string;
	accountId: string;
	userId: string;
}): Promise<void> => {
	const linkedUserId = await getUserIdByProviderAccount(data.providerId, data.accountId);
	if (linkedUserId) {
		return;
	}

	await db
		.insert(s.account)
		.values({ id: crypto.randomUUID(), ...data })
		.execute();
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
